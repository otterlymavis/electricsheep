#!/usr/bin/env swift

import Foundation
import ImageIO
import Vision

func fail(_ message: String, code: Int32 = 1) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(code)
}

guard CommandLine.arguments.count == 2 else {
  fail("Usage: ocr.swift <imagePath>")
}

let imagePath = CommandLine.arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

guard FileManager.default.fileExists(atPath: imageURL.path) else {
  fail("Image file does not exist: \(imagePath)")
}

guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
  fail("Could not load image: \(imagePath)")
}

var recognizedLines: [String] = []
var recognitionError: Error?

let request = VNRecognizeTextRequest { request, error in
  if let error {
    recognitionError = error
    return
  }

  guard let observations = request.results as? [VNRecognizedTextObservation] else {
    return
  }

  recognizedLines = observations.compactMap { observation in
    observation.topCandidates(1).first?.string
  }
}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: image, options: [:])

do {
  try handler.perform([request])
} catch {
  fail("OCR request failed: \(error.localizedDescription)")
}

if let recognitionError {
  fail("OCR recognition failed: \(recognitionError.localizedDescription)")
}

print(recognizedLines.joined(separator: "\n"))
