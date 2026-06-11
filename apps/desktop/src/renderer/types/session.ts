export type SessionArchiveSaveStatus = {
  message: string;
  state: "idle" | "saving" | "saved" | "failed";
};
