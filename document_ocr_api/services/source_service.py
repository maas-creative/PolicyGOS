import os
import ipaddress
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urljoin, urlparse

import requests
from fastapi import HTTPException

from api_models import SourceCandidate, SourceDiscoveryResponse


class PdfLinkExtractor(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.links: list[tuple[str, str]] = []
        self.page_links: list[tuple[str, str]] = []
        self._current_href: Optional[str] = None
        self._current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if not href:
            return
        self._current_href = urljoin(self.base_url, href)
        self._current_text = []

    def handle_data(self, data: str):
        if self._current_href:
            self._current_text.append(data.strip())

    def handle_endtag(self, tag: str):
        if tag != "a" or not self._current_href:
            return
        href = self._current_href
        text = " ".join(part for part in self._current_text if part).strip()
        if href.lower().endswith(".pdf"):
            self.links.append((href, text or os.path.basename(urlparse(href).path)))
        else:
            self.page_links.append((href, text or href))
        self._current_href = None
        self._current_text = []


@dataclass
class FetchedSourcePdf:
    content: bytes
    media_type: str
    file_name: str


def validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Only public HTTP(S) URLs are allowed")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="URL credentials are not allowed")
    allowed_hosts = {
        host.strip().lower()
        for host in os.environ.get("SOURCE_FETCH_ALLOWED_HOSTS", "").split(",")
        if host.strip()
    }
    if parsed.hostname.lower() not in allowed_hosts:
        raise HTTPException(status_code=403, detail="Source host is not allowlisted")
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                parsed.hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except socket.gaierror as error:
        raise HTTPException(status_code=400, detail="URL host could not be resolved") from error
    if not addresses:
        raise HTTPException(status_code=400, detail="URL host could not be resolved")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise HTTPException(
                status_code=400,
                detail="Private, local, and reserved network destinations are not allowed",
            )


def get_public_url(url: str, timeout: int) -> requests.Response:
    current_url = url
    for _ in range(4):
        validate_public_url(current_url)
        response = requests.get(current_url, timeout=timeout, allow_redirects=False)
        if response.status_code not in {301, 302, 303, 307, 308}:
            response.raise_for_status()
            return response
        location = response.headers.get("Location")
        if not location:
            raise HTTPException(status_code=502, detail="Redirect response has no location")
        current_url = urljoin(current_url, location)
    raise HTTPException(status_code=502, detail="Too many source redirects")


def decode_html_response(response: requests.Response) -> str:
    if response.encoding and response.encoding.lower() != "iso-8859-1":
        return response.text

    apparent = response.apparent_encoding or "utf-8"
    try:
        return response.content.decode(apparent, errors="replace")
    except Exception:
        return response.text


def discover_source(url: str, strategy: str) -> SourceDiscoveryResponse:
    validate_public_url(url)
    normalized_strategy = strategy.strip().lower()
    if normalized_strategy == "static-pdf-url":
        file_name = os.path.basename(urlparse(url).path) or "document.pdf"
        return SourceDiscoveryResponse(
            source_url=url,
            strategy=strategy,
            candidates=[SourceCandidate(url=url, label=file_name, file_name=file_name)],
        )

    if normalized_strategy not in {"listing-page", "viewer-kintone"}:
        raise HTTPException(status_code=400, detail=f"Unsupported strategy: {strategy}")

    try:
        response = get_public_url(url, timeout=30)
    except Exception as error:
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch source page: {error}"
        ) from error

    extractor = PdfLinkExtractor(url)
    extractor.feed(decode_html_response(response))
    discovered_links = extractor.links

    if normalized_strategy == "listing-page" and not discovered_links:
        root_host = urlparse(url).netloc
        base_prefix = url.rsplit("/", 1)[0]
        visited = {url}
        prioritized_links = [
            (page_url, label)
            for page_url, label in extractor.page_links
            if page_url.startswith(base_prefix) and page_url.lower().endswith(".html")
        ]
        fallback_links = [
            (page_url, label)
            for page_url, label in extractor.page_links
            if urlparse(page_url).netloc == root_host
            and page_url.lower().endswith(".html")
        ]

        candidate_pages = prioritized_links if prioritized_links else fallback_links

        for page_url, _label in candidate_pages[:20]:
            if page_url in visited or urlparse(page_url).netloc != root_host:
                continue
            visited.add(page_url)
            try:
                child_response = get_public_url(page_url, timeout=30)
            except Exception:
                continue

            child_extractor = PdfLinkExtractor(page_url)
            child_extractor.feed(decode_html_response(child_response))
            discovered_links.extend(child_extractor.links)

    deduped_links = []
    seen = set()
    for link_url, label in discovered_links:
        if link_url in seen:
            continue
        seen.add(link_url)
        deduped_links.append((link_url, label))

    candidates = [
        SourceCandidate(
            url=link_url,
            label=label,
            file_name=os.path.basename(urlparse(link_url).path)
            or f"document-{index + 1}.pdf",
        )
        for index, (link_url, label) in enumerate(deduped_links)
    ]

    return SourceDiscoveryResponse(
        source_url=url,
        strategy=strategy,
        candidates=candidates,
    )


def fetch_source_pdf(url: str) -> FetchedSourcePdf:
    try:
        response = get_public_url(url, timeout=60)
    except Exception as error:
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch PDF: {error}"
        ) from error

    content_type = response.headers.get("Content-Type", "application/pdf")
    if len(response.content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Fetched PDF exceeds the 50MB limit")
    if "pdf" not in content_type.lower() and not response.content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="Fetched source is not a PDF")

    return FetchedSourcePdf(
        content=response.content,
        media_type="application/pdf",
        file_name=os.path.basename(urlparse(url).path) or "document.pdf",
    )
