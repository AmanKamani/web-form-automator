/**
 * Minimal chrome API mock for unit testing outside a browser.
 * Require this in test files that need chrome.runtime or chrome.storage.
 */

let storageData = {};

globalThis.chrome = {
  runtime: {
    getManifest: () => ({ version: "1.0.0" }),
  },
  storage: {
    sync: {
      get: async () => ({ ...storageData }),
      set: async (obj) => {
        Object.assign(storageData, obj);
      },
    },
  },
};

function resetStorage(data = {}) {
  storageData = { ...data };
}

if (typeof module !== "undefined") {
  module.exports = { resetStorage };
}
