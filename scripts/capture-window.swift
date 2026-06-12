#!/usr/bin/env swift
// Captures a named app's window to a PNG using ScreenCaptureKit.
// Usage: swift capture-window.swift <app-name> <output-path>
// Requires Screen Recording permission (System Settings › Privacy › Screen Recording).

import Foundation
import ScreenCaptureKit
import CoreGraphics
import ImageIO

let argv = CommandLine.arguments
guard argv.count >= 3 else {
    fputs("Usage: capture-window <app-name> <output-path>\n", stderr)
    exit(1)
}

let appName = argv[1].lowercased()
let outPath = argv[2]

let sema     = DispatchSemaphore(value: 0)
var exitCode = Int32(0)

Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

        guard let window = content.windows.first(where: {
            ($0.owningApplication?.applicationName ?? "").lowercased().contains(appName)
        }) else {
            let names = Set(content.windows.compactMap { $0.owningApplication?.applicationName })
                .filter { !$0.isEmpty }.sorted()
            fputs("No window for '\(argv[1])'\nVisible apps: \(names.joined(separator: ", "))\n", stderr)
            exitCode = 1
            sema.signal()
            return
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.width  = max(1, Int(window.frame.width))
        config.height = max(1, Int(window.frame.height))

        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

        let url = URL(fileURLWithPath: outPath) as CFURL
        guard let dst = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else {
            fputs("Cannot create output file: \(outPath)\n", stderr)
            exitCode = 2
            sema.signal()
            return
        }
        CGImageDestinationAddImage(dst, image, nil)
        guard CGImageDestinationFinalize(dst) else {
            fputs("Failed to write image\n", stderr)
            exitCode = 3
            sema.signal()
            return
        }
        print(outPath)
    } catch {
        fputs("Capture failed: \(error.localizedDescription)\n", stderr)
        fputs("Grant Screen Recording permission in: System Settings › Privacy & Security › Screen Recording\n", stderr)
        exitCode = 1
    }
    sema.signal()
}

sema.wait()
exit(exitCode)
