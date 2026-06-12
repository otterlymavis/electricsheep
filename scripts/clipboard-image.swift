#!/usr/bin/env swift
// Saves the current macOS clipboard image as PNG.
// Usage: swift clipboard-image.swift <output-path>

import AppKit
import Foundation
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("Usage: clipboard-image <output-path>\n", stderr)
    exit(1)
}

let pasteboard = NSPasteboard.general
let outputPath = args[1]

func writePNG(_ image: NSImage, to path: String) -> Bool {
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        return false
    }
    do {
        try png.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        return false
    }
}

if let image = NSImage(pasteboard: pasteboard), writePNG(image, to: outputPath) {
    print(outputPath)
    exit(0)
}

if let png = pasteboard.data(forType: .png) {
    do {
        try png.write(to: URL(fileURLWithPath: outputPath))
        print(outputPath)
        exit(0)
    } catch {}
}

if let tiff = pasteboard.data(forType: .tiff),
   let image = NSImage(data: tiff),
   writePNG(image, to: outputPath) {
    print(outputPath)
    exit(0)
}

if #available(macOS 11.0, *) {
    if let png = pasteboard.data(forType: NSPasteboard.PasteboardType(UTType.png.identifier)) {
        do {
            try png.write(to: URL(fileURLWithPath: outputPath))
            print(outputPath)
            exit(0)
        } catch {}
    }

    for identifier in [UTType.tiff.identifier, UTType.jpeg.identifier] {
        let type = NSPasteboard.PasteboardType(identifier)
        if let data = pasteboard.data(forType: type),
           let image = NSImage(data: data),
           writePNG(image, to: outputPath) {
            print(outputPath)
            exit(0)
        }
    }
}

if let fileUrl = pasteboard.readObjects(forClasses: [NSURL.self], options: nil)?.first as? URL,
   let image = NSImage(contentsOf: fileUrl),
   writePNG(image, to: outputPath) {
    print(outputPath)
    exit(0)
}

fputs("Clipboard does not contain an image\n", stderr)
exit(2)
