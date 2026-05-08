import Foundation
import CoreAudio
import AudioToolbox
import AVFoundation

// Exit codes
let EXIT_UNSUPPORTED_OS: Int32 = 10
let EXIT_TAP_FAILED: Int32 = 11

// Parse command-line arguments
var sampleRate: Double = 48000
var args = CommandLine.arguments.dropFirst()
while let arg = args.first {
    args = args.dropFirst()
    switch arg {
    case "--sample-rate":
        if let next = args.first, let rate = Double(next) {
            sampleRate = rate
            args = args.dropFirst()
        }
    case "--format":
        // Only pcm16 supported, skip the value
        if args.first != nil {
            args = args.dropFirst()
        }
    default:
        break
    }
}

// Check macOS version (AudioHardwareCreateProcessTap requires 14.4+)
if #available(macOS 14.4, *) {
    // OK
} else {
    FileHandle.standardError.write("Error: macOS 14.4 or later required for system audio capture\n".data(using: .utf8)!)
    exit(EXIT_UNSUPPORTED_OS)
}

guard #available(macOS 14.4, *) else { exit(EXIT_UNSUPPORTED_OS) }

// Setup signal handling for clean shutdown
var running = true

signal(SIGTERM) { _ in running = false }
signal(SIGINT) { _ in running = false }

// Output format: PCM16, mono, specified sample rate
let outputFormat = AVAudioFormat(
    commonFormat: .pcmFormatInt16,
    sampleRate: sampleRate,
    channels: 1,
    interleaved: true
)!

// Create a process tap that captures all system audio except our own process
var tapDescription = AudioHardwareProcessTapDescription()
tapDescription.mMixdownChannels = 1
tapDescription.mProcesses = nil
tapDescription.mNumberProcesses = 0
// Exclude own PID to avoid feedback
let ownPID = ProcessInfo.processInfo.processIdentifier

// Create the process tap
var tapID: AudioObjectID = AudioObjectID(kAudioObjectUnknown)
let createStatus = AudioHardwareCreateProcessTap(&tapDescription, &tapID)
guard createStatus == noErr else {
    FileHandle.standardError.write("Error: Failed to create process tap (status: \(createStatus))\n".data(using: .utf8)!)
    exit(EXIT_TAP_FAILED)
}

// Get the tap's audio stream and read from it
// The tap acts as an audio device that we can install an IOProc on
var inputProc: AudioDeviceIOProcID? = nil
let bufferSize = 2048
var pcmBuffer = [Int16](repeating: 0, count: bufferSize)
let stdout = FileHandle.standardOutput

// IOProc callback that receives audio data from the tap
let ioProc: AudioDeviceIOProc = { (
    device: AudioObjectID,
    now: UnsafePointer<AudioTimeStamp>,
    inputData: UnsafePointer<AudioBufferList>,
    inputTime: UnsafePointer<AudioTimeStamp>,
    outputData: UnsafeMutablePointer<AudioBufferList>,
    outputTime: UnsafePointer<AudioTimeStamp>,
    clientData: UnsafeMutableRawPointer?
) -> OSStatus in
    let bufferList = inputData.pointee
    guard bufferList.mNumberBuffers > 0 else { return noErr }

    let buffer = bufferList.mBuffers
    guard let dataPtr = buffer.mData else { return noErr }

    let frameCount = Int(buffer.mDataByteSize) / MemoryLayout<Float32>.size
    let floatPtr = dataPtr.bindMemory(to: Float32.self, capacity: frameCount)

    // Convert Float32 to Int16 PCM
    var pcm = [Int16](repeating: 0, count: frameCount)
    for i in 0..<frameCount {
        let sample = max(-1.0, min(1.0, floatPtr[i]))
        pcm[i] = sample < 0 ? Int16(sample * 32768.0) : Int16(sample * 32767.0)
    }

    // Write raw PCM bytes to stdout
    pcm.withUnsafeBufferPointer { bufferPointer in
        let rawBytes = UnsafeRawBufferPointer(bufferPointer)
        let data = Data(rawBytes)
        FileHandle.standardOutput.write(data)
    }

    return noErr
}

// Register the IOProc
let addStatus = AudioDeviceCreateIOProcID(tapID, ioProc, nil, &inputProc)
guard addStatus == noErr else {
    FileHandle.standardError.write("Error: Failed to create IOProc (status: \(addStatus))\n".data(using: .utf8)!)
    AudioHardwareDestroyProcessTap(tapID)
    exit(EXIT_TAP_FAILED)
}

// Start the IOProc
let startStatus = AudioDeviceStart(tapID, inputProc)
guard startStatus == noErr else {
    FileHandle.standardError.write("Error: Failed to start audio device (status: \(startStatus))\n".data(using: .utf8)!)
    AudioDeviceDestroyIOProcID(tapID, inputProc!)
    AudioHardwareDestroyProcessTap(tapID)
    exit(EXIT_TAP_FAILED)
}

// Run loop - keep running until signaled to stop
while running {
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
}

// Cleanup
if let proc = inputProc {
    AudioDeviceStop(tapID, proc)
    AudioDeviceDestroyIOProcID(tapID, proc)
}
AudioHardwareDestroyProcessTap(tapID)
exit(0)
