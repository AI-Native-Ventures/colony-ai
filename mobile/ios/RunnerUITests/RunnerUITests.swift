import XCTest

final class RunnerUITests: XCTestCase {
  // Relaunch must allow a full Flutter engine cold start on a fresh
  // simulator (observed >40s before the first semantics tree appears).
  private let landingTimeout: TimeInterval = 120

  func testLandingSurvivesTerminateAndRelaunch() {
    guard let appIdentifier = testAppBundleIdentifier() else { return }

    let app = XCUIApplication(bundleIdentifier: appIdentifier)
    assertLanding(in: app, phase: "initial")

    app.terminate()
    XCTAssertEqual(app.state, .notRunning, "app did not terminate cleanly")

    assertLanding(in: app, phase: "relaunch")
  }

  private func testAppBundleIdentifier() -> String? {
    guard
      let value = Bundle(for: RunnerUITests.self).object(
        forInfoDictionaryKey: "TestAppBundleIdentifier"
      ) as? String,
      !value.isEmpty,
      !value.contains("$(")
    else {
      XCTFail("missing expanded TestAppBundleIdentifier")
      return nil
    }

    XCTAssertFalse(
      value == "xyz.block.buzz.mobile",
      "runtime proof must not target the release bundle identifier"
    )
    return value
  }

  private func assertLanding(in app: XCUIApplication, phase: String) {
    app.launch()
    XCTAssertTrue(
      app.wait(for: .runningForeground, timeout: landingTimeout),
      "app did not reach foreground during \(phase)"
    )

    let welcome = app.staticTexts["Welcome to Buzz"]
    let scan = app.buttons["Scan a QR code"]
    let pairingCode = app.buttons["Use pairing code"]

    XCTAssertTrue(
      welcome.waitForExistence(timeout: landingTimeout),
      "landing welcome label missing during \(phase)"
    )
    XCTAssertTrue(
      scan.waitForExistence(timeout: landingTimeout),
      "QR scan action missing during \(phase)"
    )
    XCTAssertTrue(
      pairingCode.waitForExistence(timeout: landingTimeout),
      "pairing-code action missing during \(phase)"
    )
    XCTAssertTrue(scan.isHittable, "QR scan action is not hittable during \(phase)")
    XCTAssertTrue(
      pairingCode.isHittable,
      "pairing-code action is not hittable during \(phase)"
    )

    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = "landing-\(phase)"
    attachment.lifetime = .keepAlways
    add(attachment)
    print("IOS_RUNTIME_STATE=landing_ok phase=\(phase)")
  }
}
