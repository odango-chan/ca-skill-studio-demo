const PROCEDURE_SUFFIX = "/assurance/procedure.yaml";
const MAX_PACKAGE_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_PACKAGE_TEXT_LENGTH = 4 * 1024 * 1024;
const EXCLUDE = "**/{node_modules,.git,.venv,__pycache__}/**";
const REQUIRED_FIRST = [
  "assurance/procedure.yaml",
  "assurance/contract.yaml",
  "assurance/predicates.yaml"
];
const TEXT_FILE = /\.(?:ya?ml|json|py|md|txt|sh|toml|xml|csv|jsonl|ini|cfg|js|ts|mjs|cjs)$/i;

function safePackageName(path) {
  const name = path.split("/").filter(Boolean).at(-1) ?? "";
  return /^[A-Za-z0-9._-]{1,100}$/.test(name) ? name : null;
}

function languageId(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  return "plaintext";
}

function insideRoot(root, uri) {
  if (!uri || uri.scheme !== root.scheme || uri.authority !== root.authority)
    return false;
  const rootPath = root.path.replace(/\/$/, "");
  return uri.path.startsWith(rootPath + "/");
}

/** Return the exact Package root for a supported Procedure document. */
export function packageRootForProcedure(vscode, document) {
  const path = document?.uri?.path;
  if (typeof path !== "string" || !path.endsWith(PROCEDURE_SUFFIX)) return null;
  const rootPath = path.slice(0, -PROCEDURE_SUFFIX.length);
  const name = safePackageName(rootPath);
  if (!name) return null;
  return { uri: document.uri.with({ path: rootPath }), name };
}

/**
 * Capture one bounded Package snapshot. Open TextDocuments override persisted
 * bytes. Any enumeration/read/size problem marks the snapshot partial; missing
 * evidence is never converted into a clean audit.
 */
export async function collectPackageSnapshot(vscode, procedureDocument, generation) {
  if (!Number.isSafeInteger(generation) || generation < 0)
    throw new Error("Package generation must be a non-negative safe integer");
  const root = packageRootForProcedure(vscode, procedureDocument);
  if (!root) throw new Error("Document is not a supported assurance/procedure.yaml");
  const rootUri = root.uri;
  const rootPath = rootUri.path.replace(/\/$/, "");
  const openDocuments = new Map(
    (vscode.workspace.textDocuments ?? []).map(document =>
      [document.uri.toString(), document])
  );
  openDocuments.set(procedureDocument.uri.toString(), procedureDocument);

  let found = [];
  let completeness = "complete";
  const reasons = [];
  try {
    found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(rootUri, "**/*"),
      EXCLUDE,
      MAX_PACKAGE_FILES + 1
    );
  } catch (error) {
    completeness = "unavailable";
    reasons.push("Package file enumeration failed: " + String(error?.message ?? error));
  }

  const candidates = new Map();
  for (const uri of found) {
    if (!insideRoot(rootUri, uri)) {
      completeness = "partial";
      reasons.push("Ignored a file URI outside the selected Package root");
      continue;
    }
    const relativePath = uri.path.slice(rootPath.length).replace(/^\//, "");
    if (!relativePath || relativePath.includes("\\") ||
        relativePath.split("/").some(part => !part || part === "." || part === "..")) {
      completeness = "partial";
      reasons.push("Ignored an unsafe Package-relative path");
      continue;
    }
    candidates.set(uri.toString(), { uri, relativePath });
  }
  if (!candidates.has(procedureDocument.uri.toString())) {
    candidates.set(procedureDocument.uri.toString(), {
      uri: procedureDocument.uri,
      relativePath: "assurance/procedure.yaml"
    });
  }

  let entries = [...candidates.values()];
  entries.sort((a, b) => {
    const ai = REQUIRED_FIRST.indexOf(a.relativePath);
    const bi = REQUIRED_FIRST.indexOf(b.relativePath);
    const ar = ai < 0 ? REQUIRED_FIRST.length : ai;
    const br = bi < 0 ? REQUIRED_FIRST.length : bi;
    return ar - br || a.relativePath.localeCompare(b.relativePath);
  });
  if (found.length > MAX_PACKAGE_FILES || entries.length > MAX_PACKAGE_FILES) {
    completeness = "partial";
    reasons.push("Package exceeds the 500-file analysis limit");
    entries = entries.slice(0, MAX_PACKAGE_FILES);
  }

  const documents = [];
  let totalTextLength = 0;
  for (const entry of entries) {
    const uri = entry.uri;
    const relativePath = entry.relativePath;
    const open = openDocuments.get(uri.toString());
    let text = "";
    if (TEXT_FILE.test(relativePath)) {
      try {
        if (open) {
          text = open.getText();
          if (text.length > MAX_FILE_BYTES) throw new Error("file exceeds 1 MiB");
        } else {
          const stat = await vscode.workspace.fs.stat(uri);
          if (Number.isFinite(stat.size) && stat.size > MAX_FILE_BYTES)
            throw new Error("file exceeds 1 MiB");
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("file exceeds 1 MiB");
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        }
        if (totalTextLength + text.length > MAX_PACKAGE_TEXT_LENGTH)
          throw new Error("Package exceeds 4 MiB of text");
        totalTextLength += text.length;
      } catch (error) {
        completeness = "partial";
        reasons.push(relativePath + ": " + String(error?.message ?? error));
        text = "";
      }
    }
    documents.push({
      uri: uri.toString(),
      relativePath,
      languageId: languageId(relativePath),
      version: open && Number.isSafeInteger(open.version) && open.version >= 0
        ? open.version : 0,
      text
    });
  }

  return {
    rootUri: rootUri.toString(),
    packageName: root.name,
    generation,
    completeness,
    documents,
    ...(reasons.length ? { reason: [...new Set(reasons)].join("; ").slice(0, 2000) } : {})
  };
}

export const PACKAGE_SNAPSHOT_LIMITS = Object.freeze({
  files: MAX_PACKAGE_FILES,
  fileBytes: MAX_FILE_BYTES,
  packageTextLength: MAX_PACKAGE_TEXT_LENGTH
});
