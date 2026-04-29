// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OrionlyAudioCapture",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "OrionlyAudioCapture",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("CoreAudio"),
                .linkedFramework("AudioToolbox"),
                .linkedFramework("AVFoundation"),
            ]
        ),
    ]
)
