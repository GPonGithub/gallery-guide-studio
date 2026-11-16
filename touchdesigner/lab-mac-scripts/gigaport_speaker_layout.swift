import CoreAudio
import Foundation
// Gives the GIGAPORT eX's outputs 1-4 speaker labels (Left, Right, Left Surround, Right Surround), so Chrome
// plays four separate channels on them. Pass "restore" to put back Left/Right on 1-2 only.
let restore = CommandLine.arguments.contains("restore")
var a = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
var size: UInt32 = 0; AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size)
var ids = [AudioObjectID](repeating: 0, count: Int(size) / 4); AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &a, 0, nil, &size, &ids)
for id in ids {
  var na = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var name: Unmanaged<CFString>? = nil; var ns = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  AudioObjectGetPropertyData(id, &na, 0, nil, &ns, &name)
  guard let n = name?.takeRetainedValue() as String?, n.lowercased().contains("gigaport") else { continue }
  var la = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyPreferredChannelLayout, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
  var ls: UInt32 = 0; guard AudioObjectGetPropertyDataSize(id, &la, 0, nil, &ls) == 0 else { continue }
  let buf = UnsafeMutableRawPointer.allocate(byteCount: Int(ls), alignment: 8)
  AudioObjectGetPropertyData(id, &la, 0, nil, &ls, buf)
  let layout = buf.assumingMemoryBound(to: AudioChannelLayout.self)
  let count = Int(layout.pointee.mNumberChannelDescriptions)
  let labels: [AudioChannelLabel] = restore
    ? [kAudioChannelLabel_Left, kAudioChannelLabel_Right]
    : [kAudioChannelLabel_Left, kAudioChannelLabel_Right, kAudioChannelLabel_LeftSurround, kAudioChannelLabel_RightSurround]
  withUnsafeMutablePointer(to: &layout.pointee.mChannelDescriptions) { p in
    let d = UnsafeMutableRawPointer(p).assumingMemoryBound(to: AudioChannelDescription.self)
    for i in 0..<count { d[i].mChannelLabel = i < labels.count ? labels[i] : kAudioChannelLabel_Unknown }
  }
  layout.pointee.mChannelLayoutTag = kAudioChannelLayoutTag_UseChannelDescriptions
  let st = AudioObjectSetPropertyData(id, &la, 0, nil, ls, buf)
  print(n, st == 0 ? "set" : "failed \(st)")
  var check: UInt32 = ls; AudioObjectGetPropertyData(id, &la, 0, nil, &check, buf)
  withUnsafePointer(to: &layout.pointee.mChannelDescriptions) { p in
    let d = UnsafeRawPointer(p).assumingMemoryBound(to: AudioChannelDescription.self)
    print("now:", (0..<count).map { "\($0 + 1)=\(d[$0].mChannelLabel == kAudioChannelLabel_Unknown ? "-" : String(d[$0].mChannelLabel))" }.joined(separator: " "))
  }
}
