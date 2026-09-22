// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FinancialTrackingCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "FinancialTrackingCore", targets: ["FinancialTrackingCore"])
    ],
    targets: [
        .target(name: "FinancialTrackingCore", path: "Sources/FinancialTrackingCore"),
        .testTarget(
            name: "FinancialTrackingCoreTests",
            dependencies: ["FinancialTrackingCore"],
            path: "Financial TrackingTests"
        )
    ]
)