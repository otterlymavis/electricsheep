#!/usr/bin/env swift
// Captures a named app's window to a PNG file.
// Usage: swift capture-window.swift <app-name> <output-path>

import Foundation
import CoreGraphics
import ImageIO

let argv = CommandLine.arguments
guard argv.count >= 3 else {
    fputs("Usage: capture-window <app-name> <output-path>\n", stderr)
    exit(1)
}

let appName   = argv[1].lowercased()
let outPath   = argv[2]

guard let windowList = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID
) as? [[String: Any]] else {
    fputs("Failed to read window list\n", stderr)
    exit(1)
}

// Pick the frontmost normal window whose owner name contains the query
let match = windowList.first { win in
    guard let owner = win[kCGWindowOwnerName as String] as? String,
          let layer = win[kCGWindowLayer as String] as? Int,
          layer == 0 else { return false }
    return owner.lowercased().contains(appName)
}

guard let win  = match,
      let wid  = win[kCGWindowNumber as String] as? CGWindowID else {
    let visible = Set(windowList.compactMap { $0[kCGWindowOwnerName as String] as? String })
        .filter { !$0.isEmpty }.sorted()
    fputs("No window found for '\(argv[1])'\nVisible: \(visible.joined(separator: ", "))\n", stderr)
    exit(1)
}

guard let img = CGWindowListCreateImage(
    .null, .optionIncludingWindow, wid, [.boundsIgnoreFraming, .nominalResolution]
) else {
    fputs("Screen Recording permission required.\nGrant in: System Settings › Privacy & Security › Screen Recording\n", stderr)
    exit(2)
}

let url  = URL(fileURLWithPath: outPath) as CFURL
guard let dst = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else {
    fputs("Cannot create output file: \(outPath)\n", stderr); exit(3)
}
CGImageDestinationAddImage(dst, img, nil)
guard CGImageDestinationFinalize(dst) else {
    fputs("Failed to write image\n", stderr); exit(4)
}

print(outPath)
