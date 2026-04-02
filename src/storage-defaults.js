/**
 * Shared storage keys, default field configs, and migration logic.
 * Loaded by options.js, popup.js, and background.js.
 */

const STORAGE_KEYS = {
  DOMAIN: "domain",
  FIELD_CONFIGS: "fieldConfigs",
  ACTIVE_PAYLOAD: "activePayload",
  TEMPLATES: "templates",
  LAST_INPUT_MODE: "lastInputMode",
  LAST_TEMPLATE_ID: "lastTemplateId",
  FLOWS: "flows",
  LAST_FLOW_ID: "lastFlowId",
};

const DEFAULT_FIELD_CONFIGS = [
  {
    key: "groupName",
    displayName: "Group Name",
    labelMatch: ["group name"],
    fieldType: "typeahead",
    ajaxWait: 1500,
    dropdownRetries: 15,
    enabled: true,
  },
  {
    key: "action",
    displayName: "Add/Delete Action",
    labelMatch: ["do you want to add the users", "add the users or delete"],
    fieldType: "typeahead",
    ajaxWait: 1500,
    dropdownRetries: 15,
    enabled: true,
  },
  {
    key: "members",
    displayName: "Members",
    labelMatch: ["choose members", "members to add", "remove from the group"],
    fieldType: "typeahead",
    ajaxWait: 10000,
    dropdownRetries: 30,
    enabled: true,
  },
  {
    key: "businessJustification",
    displayName: "Business Justification",
    labelMatch: ["business justification"],
    fieldType: "text",
    ajaxWait: 1500,
    dropdownRetries: 15,
    enabled: true,
  },
];

const EMPTY_PAYLOAD = {
  groupName: "",
  action: "add",
  members: [],
  businessJustification: "",
};

/**
 * Ensures storage has all required keys with sensible defaults.
 * Returns the full resolved config object.
 */
async function loadOrMigrateStorage() {
  const data = await chrome.storage.sync.get(null);
  const updates = {};

  if (!data[STORAGE_KEYS.FIELD_CONFIGS]) {
    updates[STORAGE_KEYS.FIELD_CONFIGS] = DEFAULT_FIELD_CONFIGS;
  }
  if (!data[STORAGE_KEYS.ACTIVE_PAYLOAD]) {
    updates[STORAGE_KEYS.ACTIVE_PAYLOAD] = EMPTY_PAYLOAD;
  }
  if (!data[STORAGE_KEYS.TEMPLATES]) {
    updates[STORAGE_KEYS.TEMPLATES] = [];
  }
  if (!data[STORAGE_KEYS.LAST_INPUT_MODE]) {
    updates[STORAGE_KEYS.LAST_INPUT_MODE] = "upload";
  }
  if (!data[STORAGE_KEYS.FLOWS]) {
    updates[STORAGE_KEYS.FLOWS] = [];
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.sync.set(updates);
  }

  return { ...data, ...updates };
}

if (typeof module !== "undefined") {
  module.exports = {
    STORAGE_KEYS,
    DEFAULT_FIELD_CONFIGS,
    EMPTY_PAYLOAD,
    loadOrMigrateStorage,
  };
}
