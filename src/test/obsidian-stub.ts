// Stand-in for the obsidian module in unit tests (vitest.config.mjs).
// The package carries only types, so modules that import values from it
// cannot load in Node otherwise. Tests that reach these values mock what
// they need; the stand-ins only let the modules load.

export class Notice {
    constructor(_message?: string, _duration?: number) {}
}

export function setIcon(_el: unknown, _icon: string): void {}
