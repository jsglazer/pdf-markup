// make-icon.swift — draws the PDF Markup app icon with CoreGraphics and writes the asset catalog.
//
//   swift scripts/make-icon.swift App/Sources/Assets.xcassets
//
// Design: deep-navy tile, cyan page outline with faint text lines and a folded corner, circuit-trace
// accents, and a glowing cyan freehand loop drawn by a stylus nib. iOS gets a full-bleed square (the
// system applies the mask); macOS gets the standard rounded tile inside the 1024 grid with a shadow.
import AppKit
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write(Data("usage: swift make-icon.swift <Assets.xcassets>\n".utf8))
    exit(1)
}
let catalog = URL(fileURLWithPath: args[1])

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

let cyan: UInt32 = 0x22E5FF
let cyanDeep: UInt32 = 0x00A8D6
let navyTop: UInt32 = 0x0D2A44
let navyBottom: UInt32 = 0x040C18

/// Draws the artwork into a 1024×1024 design space. `mac` = rounded tile with margin + shadow.
func draw(_ ctx: CGContext, mac: Bool) {
    let space = CGColorSpace(name: CGColorSpace.sRGB)
    // Flip to a top-left origin so the coordinates read like a design file.
    ctx.translateBy(x: 0, y: 1024)
    ctx.scaleBy(x: 1, y: -1)

    let tile = mac ? CGRect(x: 100, y: 100, width: 824, height: 824) : CGRect(x: 0, y: 0, width: 1024, height: 1024)
    let tilePath = mac ? CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185, transform: nil) : CGPath(rect: tile, transform: nil)

    // Tile with drop shadow (macOS) and vertical navy gradient.
    if mac {
        ctx.saveGState()
        ctx.setShadow(offset: CGSize(width: 0, height: 12), blur: 28, color: color(0x000000, 0.45))
        ctx.addPath(tilePath)
        ctx.setFillColor(color(navyBottom))
        ctx.fillPath()
        ctx.restoreGState()
    }
    ctx.saveGState()
    ctx.addPath(tilePath)
    ctx.clip()
    let bg = CGGradient(colorsSpace: space, colors: [color(navyTop), color(navyBottom)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: tile.minY), end: CGPoint(x: 0, y: tile.maxY), options: [])
    // Soft cyan glow behind the page.
    let glow = CGGradient(colorsSpace: space, colors: [color(cyan, 0.30), color(cyan, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(glow, startCenter: CGPoint(x: 512, y: 470), startRadius: 0, endCenter: CGPoint(x: 512, y: 470), endRadius: 430, options: [])

    // Subtle grid for a technical feel.
    ctx.setStrokeColor(color(cyan, 0.06))
    ctx.setLineWidth(2)
    var g: CGFloat = tile.minX
    while g <= tile.maxX {
        ctx.move(to: CGPoint(x: g, y: tile.minY)); ctx.addLine(to: CGPoint(x: g, y: tile.maxY))
        ctx.move(to: CGPoint(x: tile.minX, y: g)); ctx.addLine(to: CGPoint(x: tile.maxX, y: g))
        g += 64
    }
    ctx.strokePath()

    // Circuit traces leaving the page to the left and bottom, ending in nodes.
    ctx.setStrokeColor(color(cyanDeep, 0.85))
    ctx.setLineWidth(10)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    let traces: [[CGPoint]] = [
        [CGPoint(x: 330, y: 400), CGPoint(x: 250, y: 400), CGPoint(x: 210, y: 360)],
        [CGPoint(x: 330, y: 560), CGPoint(x: 230, y: 560)],
        [CGPoint(x: 330, y: 700), CGPoint(x: 270, y: 700), CGPoint(x: 230, y: 740)],
        [CGPoint(x: 470, y: 795), CGPoint(x: 470, y: 860)],
    ]
    for t in traces {
        ctx.move(to: t[0])
        for p in t.dropFirst() { ctx.addLine(to: p) }
    }
    ctx.strokePath()
    for t in traces {
        guard let end = t.last else { continue }
        ctx.setFillColor(color(navyBottom))
        ctx.fillEllipse(in: CGRect(x: end.x - 17, y: end.y - 17, width: 34, height: 34))
        ctx.setStrokeColor(color(cyan))
        ctx.setLineWidth(8)
        ctx.strokeEllipse(in: CGRect(x: end.x - 17, y: end.y - 17, width: 34, height: 34))
    }

    // The page: dark glassy fill, cyan outline, folded top-right corner.
    let page = CGRect(x: 330, y: 230, width: 380, height: 565)
    let fold: CGFloat = 95
    let pagePath = CGMutablePath()
    pagePath.move(to: CGPoint(x: page.minX + 28, y: page.minY))
    pagePath.addLine(to: CGPoint(x: page.maxX - fold, y: page.minY))
    pagePath.addLine(to: CGPoint(x: page.maxX, y: page.minY + fold))
    pagePath.addLine(to: CGPoint(x: page.maxX, y: page.maxY - 28))
    pagePath.addQuadCurve(to: CGPoint(x: page.maxX - 28, y: page.maxY), control: CGPoint(x: page.maxX, y: page.maxY))
    pagePath.addLine(to: CGPoint(x: page.minX + 28, y: page.maxY))
    pagePath.addQuadCurve(to: CGPoint(x: page.minX, y: page.maxY - 28), control: CGPoint(x: page.minX, y: page.maxY))
    pagePath.addLine(to: CGPoint(x: page.minX, y: page.minY + 28))
    pagePath.addQuadCurve(to: CGPoint(x: page.minX + 28, y: page.minY), control: CGPoint(x: page.minX, y: page.minY))
    pagePath.closeSubpath()
    ctx.addPath(pagePath)
    ctx.setFillColor(color(0x0A2238, 0.92))
    ctx.fillPath()
    ctx.saveGState()
    ctx.setShadow(offset: .zero, blur: 22, color: color(cyan, 0.8))
    ctx.addPath(pagePath)
    ctx.setStrokeColor(color(cyan))
    ctx.setLineWidth(12)
    ctx.strokePath()
    ctx.restoreGState()
    // Fold triangle.
    let foldPath = CGMutablePath()
    foldPath.move(to: CGPoint(x: page.maxX - fold, y: page.minY))
    foldPath.addLine(to: CGPoint(x: page.maxX - fold, y: page.minY + fold - 10))
    foldPath.addQuadCurve(to: CGPoint(x: page.maxX - fold + 10, y: page.minY + fold), control: CGPoint(x: page.maxX - fold, y: page.minY + fold))
    foldPath.addLine(to: CGPoint(x: page.maxX, y: page.minY + fold))
    ctx.addPath(foldPath)
    ctx.setStrokeColor(color(cyan))
    ctx.setLineWidth(10)
    ctx.strokePath()

    // "Text" lines on the page.
    ctx.setLineCap(.round)
    ctx.setLineWidth(18)
    let lines: [(CGFloat, CGFloat, CGFloat)] = [(390, 590, 0.55), (390, 640, 0.35), (480, 600, 0.35), (550, 560, 0.35), (620, 640, 0.35), (690, 520, 0.35)]
    for (y, len, a) in lines {
        ctx.setStrokeColor(color(cyan, a))
        ctx.move(to: CGPoint(x: 385, y: y))
        ctx.addLine(to: CGPoint(x: len, y: y))
        ctx.strokePath()
    }
    // Title line drawn solid.
    ctx.setStrokeColor(color(cyan, 0.9))
    ctx.setLineWidth(22)
    ctx.move(to: CGPoint(x: 385, y: 320))
    ctx.addLine(to: CGPoint(x: 540, y: 320))
    ctx.strokePath()

    // The markup: a bright freehand loop circling a line, with glow, ending at the stylus nib.
    let stroke = CGMutablePath()
    stroke.move(to: CGPoint(x: 600, y: 520))
    stroke.addCurve(to: CGPoint(x: 400, y: 590), control1: CGPoint(x: 560, y: 470), control2: CGPoint(x: 400, y: 500))
    stroke.addCurve(to: CGPoint(x: 590, y: 655), control1: CGPoint(x: 400, y: 660), control2: CGPoint(x: 530, y: 670))
    stroke.addCurve(to: CGPoint(x: 735, y: 560), control1: CGPoint(x: 660, y: 640), control2: CGPoint(x: 700, y: 600))
    ctx.saveGState()
    ctx.setShadow(offset: .zero, blur: 30, color: color(cyan, 1))
    ctx.addPath(stroke)
    ctx.setStrokeColor(color(0xE8FDFF))
    ctx.setLineWidth(20)
    ctx.setLineCap(.round)
    ctx.strokePath()
    ctx.restoreGState()

    // Stylus, angled up-right from the end of the stroke.
    ctx.saveGState()
    ctx.translateBy(x: 735, y: 560)
    ctx.rotate(by: -.pi / 4)
    let body = CGRect(x: 40, y: -30, width: 175, height: 60)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: 10), blur: 24, color: color(0x000000, 0.55))
    ctx.addPath(CGPath(roundedRect: body, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.setFillColor(color(0xF2FBFF))
    ctx.fillPath()
    ctx.restoreGState()
    let bodyGrad = CGGradient(colorsSpace: space, colors: [color(0xFFFFFF), color(0xBFEFFA)] as CFArray, locations: [0, 1])!
    ctx.saveGState()
    ctx.addPath(CGPath(roundedRect: body, cornerWidth: 30, cornerHeight: 30, transform: nil))
    ctx.clip()
    ctx.drawLinearGradient(bodyGrad, start: CGPoint(x: 0, y: -30), end: CGPoint(x: 0, y: 30), options: [])
    ctx.restoreGState()
    // Cyan band near the tip.
    ctx.setFillColor(color(cyan))
    ctx.fill(CGRect(x: 70, y: -30, width: 22, height: 60))
    // Conical tip.
    let tip = CGMutablePath()
    tip.move(to: CGPoint(x: 44, y: -27))
    tip.addLine(to: CGPoint(x: 0, y: 0))
    tip.addLine(to: CGPoint(x: 44, y: 27))
    tip.closeSubpath()
    ctx.addPath(tip)
    ctx.setFillColor(color(0xDDF6FC))
    ctx.fillPath()
    ctx.setFillColor(color(cyan))
    ctx.fillEllipse(in: CGRect(x: -6, y: -6, width: 14, height: 12))
    ctx.restoreGState()

    ctx.restoreGState() // tile clip
}

func render(size: Int, mac: Bool) -> Data {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("no context") }
    ctx.interpolationQuality = .high
    ctx.scaleBy(x: CGFloat(size) / 1024, y: CGFloat(size) / 1024)
    draw(ctx, mac: mac)
    guard let image = ctx.makeImage() else { fatalError("no image") }
    let rep = NSBitmapImageRep(cgImage: image)
    guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("no png") }
    return png
}

let iconSet = catalog.appendingPathComponent("AppIcon.appiconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconSet, withIntermediateDirectories: true)
try Data(#"{"info":{"author":"xcode","version":1}}"#.utf8).write(to: catalog.appendingPathComponent("Contents.json"))

var images: [[String: String]] = []
try render(size: 1024, mac: false).write(to: iconSet.appendingPathComponent("ios-1024.png"))
images.append(["filename": "ios-1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"])
for (points, scales) in [(16, [1, 2]), (32, [1, 2]), (128, [1, 2]), (256, [1, 2]), (512, [1, 2])] {
    for scale in scales {
        let px = points * scale
        let name = "mac-\(points)@\(scale)x.png"
        try render(size: px, mac: true).write(to: iconSet.appendingPathComponent(name))
        images.append(["filename": name, "idiom": "mac", "scale": "\(scale)x", "size": "\(points)x\(points)"])
    }
}
let contents: [String: Any] = ["images": images, "info": ["author": "xcode", "version": 1]]
try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys]).write(to: iconSet.appendingPathComponent("Contents.json"))
print("Wrote \(images.count) icon images to \(iconSet.path)")
