import XCTest

final class RunnerUITests: XCTestCase {
  // Relaunch must allow a full Flutter engine cold start on a fresh
  // simulator (observed >40s before the first semantics tree appears).
  private let landingTimeout: TimeInterval = 120

  func testLandingSurvivesTerminateAndRelaunch() {
    guard let appIdentifier = testAppBundleIdentifier() else { return }

    let app = XCUIApplication(bundleIdentifier: appIdentifier)

    assertAccountLanding(in: app, phase: "initial")

    let advanced = app.buttons["Advanced: use an existing Nostr identity"]
    XCTAssertTrue(
      advanced.waitForExistence(timeout: landingTimeout),
      "Advanced identity action missing on the account screen"
    )
    XCTAssertTrue(advanced.isHittable, "Advanced identity action is not hittable")
    advanced.tap()

    let scan = app.buttons["Scan a QR code"]
    let pairingCode = app.buttons["Use pairing code"]
    XCTAssertTrue(
      scan.waitForExistence(timeout: landingTimeout),
      "Advanced identity action did not open pairing"
    )
    XCTAssertTrue(
      pairingCode.waitForExistence(timeout: landingTimeout),
      "pairing-code action missing behind Advanced"
    )
    XCTAssertTrue(scan.isHittable, "QR scan action is not hittable behind Advanced")
    XCTAssertTrue(
      pairingCode.isHittable,
      "pairing-code action is not hittable behind Advanced"
    )
    XCTAssertFalse(
      app.buttons["Create account"].exists,
      "account actions remained visible after opening Advanced pairing"
    )

    let pairingAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    pairingAttachment.name = "landing-advanced-pairing"
    pairingAttachment.lifetime = .keepAlways
    add(pairingAttachment)

    app.terminate()
    XCTAssertEqual(app.state, .notRunning, "app did not terminate cleanly")

    assertAccountLanding(in: app, phase: "relaunch")
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

  private func assertAccountLanding(in app: XCUIApplication, phase: String) {
    app.launch()
    XCTAssertTrue(
      app.wait(for: .runningForeground, timeout: landingTimeout),
      "app did not reach foreground during \(phase)"
    )

    let welcome = app.staticTexts["Welcome to Buzz"]
    let createAccount = app.buttons["Create account"]
    let google = app.buttons["Continue with Google"]
    let signIn = app.buttons["Sign in"]
    let advanced = app.buttons["Advanced: use an existing Nostr identity"]
    let scan = app.buttons["Scan a QR code"]
    let pairingCode = app.buttons["Use pairing code"]

    XCTAssertTrue(
      welcome.waitForExistence(timeout: landingTimeout),
      "account welcome label missing during \(phase)"
    )
    XCTAssertTrue(
      createAccount.waitForExistence(timeout: landingTimeout),
      "create-account action missing during \(phase)"
    )
    XCTAssertTrue(
      google.waitForExistence(timeout: landingTimeout),
      "Google sign-in action missing during \(phase)"
    )
    XCTAssertTrue(
      signIn.waitForExistence(timeout: landingTimeout),
      "sign-in action missing during \(phase)"
    )
    XCTAssertTrue(
      advanced.waitForExistence(timeout: landingTimeout),
      "Advanced identity action missing during \(phase)"
    )
    XCTAssertTrue(createAccount.isHittable, "create-account action is not hittable during \(phase)")
    XCTAssertTrue(signIn.isHittable, "sign-in action is not hittable during \(phase)")
    XCTAssertTrue(
      advanced.isHittable,
      "Advanced identity action is not hittable during \(phase)"
    )
    XCTAssertFalse(
      scan.exists,
      "QR scan action must stay behind Advanced during \(phase)"
    )
    XCTAssertFalse(
      pairingCode.exists,
      "pairing-code action must stay behind Advanced during \(phase)"
    )

    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = "landing-\(phase)"
    attachment.lifetime = .keepAlways
    add(attachment)
    print("IOS_RUNTIME_STATE=landing_ok phase=\(phase)")
  }
}
