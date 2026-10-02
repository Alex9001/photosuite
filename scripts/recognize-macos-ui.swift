// Read-only screenshot OCR. Requires the Apple Vision framework already on macOS.
import Foundation
import Vision
import ImageIO

if CommandLine.arguments.count != 2 {
    fputs("Usage: recognize-macos-ui screenshot.png\n", stderr)
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Cannot decode screenshot\n", stderr)
    exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
request.usesLanguageCorrection = false
do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    for observation in request.results ?? [] {
        if let candidate = observation.topCandidates(1).first {
            print(candidate.string)
        }
    }
} catch {
    fputs("Screenshot OCR failed: \(error)\n", stderr)
    exit(2)
}
