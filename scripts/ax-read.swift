#!/usr/bin/env swift
// Reads visible text from a running app via the macOS Accessibility API.
// Usage: swift ax-read.swift <app-name>

import Foundation
import AppKit
import ApplicationServices

let argv = CommandLine.arguments
guard argv.count >= 2 else {
    fputs("Usage: ax-read <app-name>\n", stderr)
    exit(1)
}

let query = argv[1].lowercased()

guard AXIsProcessTrusted() else {
    fputs("Accessibility permission required.\nGrant in: System Settings › Privacy & Security › Accessibility\n", stderr)
    exit(1)
}

let apps = NSWorkspace.shared.runningApplications
guard let app = apps.first(where: {
    guard let n = $0.localizedName else { return false }
    return n.lowercased().contains(query) && $0.activationPolicy == .regular
}) else {
    let names = apps.filter { $0.activationPolicy == .regular }
                    .compactMap { $0.localizedName }.sorted()
    fputs("'\(argv[1])' not running.\nRunning apps: \(names.joined(separator: ", "))\n", stderr)
    exit(1)
}

let axApp = AXUIElementCreateApplication(app.processIdentifier)

var wRef: CFTypeRef?
guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &wRef) == .success,
      let windows = wRef as? [AXUIElement], !windows.isEmpty else {
    fputs("No accessible windows for '\(app.localizedName ?? argv[1])'\n", stderr)
    exit(1)
}

var seen    = Set<String>()
var results = [String]()

func harvest(_ el: AXUIElement, depth: Int) {
    guard depth < 30 else { return }
    for attr in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
        var ref: CFTypeRef?
        guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success,
              let s = ref as? String, s.count > 3,
              seen.insert(s).inserted else { continue }
        results.append(s)
    }
    var cRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &cRef) == .success,
          let children = cRef as? [AXUIElement] else { return }
    for child in children { harvest(child, depth: depth + 1) }
}

for w in windows { harvest(w, depth: 0) }

guard !results.isEmpty else {
    fputs("No text found in '\(app.localizedName ?? argv[1])'\n", stderr)
    exit(1)
}

print(results.joined(separator: "\n"))
