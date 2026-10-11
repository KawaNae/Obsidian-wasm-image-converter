import { describe, expect, it } from "vitest";
import { pickHostDocument } from "./host-document";

const workspaceWindows = new Set(["main", "popout"]);
const showsWorkspace = (doc: string) => workspaceWindows.has(doc);

describe("pickHostDocument", () => {
  it("opens in the note's window when there is one", () => {
    expect(pickHostDocument("popout", "settings", "main", showsWorkspace)).toBe("popout");
  });

  it("opens in the window the user works in when it shows the workspace", () => {
    expect(pickHostDocument(null, "popout", "main", showsWorkspace)).toBe("popout");
  });

  it("opens in the main window when the user works in the settings window", () => {
    expect(pickHostDocument(null, "settings", "main", showsWorkspace)).toBe("main");
  });

  it("opens in the main window when no window is active", () => {
    expect(pickHostDocument(null, null, "main", showsWorkspace)).toBe("main");
  });
});
