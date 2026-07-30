import {
  parsePolicyDataset,
  type PolicyDataset
} from "@policygos/policy-schema";

const DATABASE_NAME = "policygos-next";
const DATABASE_VERSION = 2;
const STORE_NAME = "workspace";
const SOURCE_STORE_NAME = "source-pdfs";
const CURRENT_DATASET_KEY = "current-policy-dataset";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(SOURCE_STORE_NAME)) {
        request.result.createObjectStore(SOURCE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadPolicyDataset(): Promise<PolicyDataset | undefined> {
  const database = await openDatabase();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(CURRENT_DATASET_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return value === undefined ? undefined : parsePolicyDataset(value);
  } finally {
    database.close();
  }
}

export async function savePolicyDataset(dataset: PolicyDataset): Promise<void> {
  const validated = parsePolicyDataset(dataset);
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction
        .objectStore(STORE_NAME)
        .put(validated, CURRENT_DATASET_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function clearPolicyDataset(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(CURRENT_DATASET_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveSourcePdf(
  documentId: string,
  file: File
): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(SOURCE_STORE_NAME, "readwrite");
      transaction.objectStore(SOURCE_STORE_NAME).put(
        { blob: file.slice(0, file.size, "application/pdf"), fileName: file.name },
        documentId
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function loadSourcePdf(
  documentId: string
): Promise<{ blob: Blob; fileName: string } | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(SOURCE_STORE_NAME, "readonly");
      const request = transaction.objectStore(SOURCE_STORE_NAME).get(documentId);
      request.onsuccess = () =>
        resolve(
          request.result as { blob: Blob; fileName: string } | undefined
        );
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function clearWorkspace(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        [STORE_NAME, SOURCE_STORE_NAME],
        "readwrite"
      );
      transaction.objectStore(STORE_NAME).clear();
      transaction.objectStore(SOURCE_STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}
