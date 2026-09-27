import XCTest

final class RunnerUITests: XCTestCase {
  // Relaunch must allow a full Flutter engine cold start on a fresh
  // simulator (observed >40s before the first semantics tree appears).
  private let landingTimeout: TimeInterval = 120

  func testLandingSurvivesTerminateAndRelaunch() {
    guard let appIdentifier = testAppBundleIdentifier() else { return }

    let app = XCUIApplication(bundleIdentifier: appIdentifier)

    assertAccountLanding(in: app, phase: "initial")

    // r18: pairing an existing identity starts from "Pair with my desktop"
    // on the landing, replacing the old "Advanced" entry.
    let pair = app.buttons["Pair with my desktop"]
    XCTAssertTrue(
      pair.waitForExistence(timeout: landingTimeout),
      "Pair with my desktop action missing on the account screen"
    )
    XCTAssertTrue(pair.isHittable, "Pair with my desktop action is not hittable")
    pair.tap()

    let scan = app.buttons["Scan QR code"]
    let enterCode = app.buttons["Enter a code instead"]
    XCTAssertTrue(
      scan.waitForExistence(timeout: landingTimeout),
      "Pair with my desktop did not open pairing"
    )
    XCTAssertTrue(
      enterCode.waitForExistence(timeout: landingTimeout),
      "enter-code action missing on the pairing start screen"
    )
    XCTAssertTrue(scan.isHittable, "QR scan action is not hittable on the pairing start screen")
    XCTAssertTrue(
      enterCode.isHittable,
      "enter-code action is not hittable on the pairing start screen"
    )
    XCTAssertFalse(
      app.buttons["Create an account"].exists,
      "account actions remained visible after opening pairing"
    )

    let pairingAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    pairingAttachment.name = "landing-pairing-start"
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
      value == "ventures.ainative.colony",
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

    // r18/r19 account entry: brand eyebrow, then create / sign in / pair.
    // Google sign-in moved onto the create and sign-in screens.
    // The eyebrow is a plain Flutter Text. In roughly one run in ten it was on
    // screen but absent from staticTexts (PR #103, run 36331510553), so match
    // its copy by label on any element type.
    let eyebrow = app.descendants(matching: .any)
      .matching(NSPredicate(format: "label CONTAINS %@", "A HOME FOR YOUR BUSINESS"))
      .firstMatch
    let createAccount = app.buttons["Create an account"]
    let signIn = app.buttons["I already have an account"]
    let pair = app.buttons["Pair with my desktop"]
    let scan = app.buttons["Scan QR code"]
    let enterCode = app.buttons["Enter a code instead"]

    if !eyebrow.waitForExistence(timeout: landingTimeout) {
      // Keep the accessibility tree so the next miss shows how Flutter
      // exposed the eyebrow instead of only a screenshot.
      let tree = XCTAttachment(string: app.debugDescription)
      tree.name = "landing-\(phase)-accessibility-tree"
      tree.lifetime = .keepAlways
      add(tree)
      XCTFail("account landing eyebrow missing during \(phase)")
    }
    XCTAssertTrue(
      createAccount.waitForExistence(timeout: landingTimeout),
      "create-account action missing during \(phase)"
    )
    XCTAssertTrue(
      signIn.waitForExistence(timeout: landingTimeout),
      "sign-in action missing during \(phase)"
    )
    XCTAssertTrue(
      pair.waitForExistence(timeout: landingTimeout),
      "Pair with my desktop action missing during \(phase)"
    )
    XCTAssertTrue(createAccount.isHittable, "create-account action is not hittable during \(phase)")
    XCTAssertTrue(signIn.isHittable, "sign-in action is not hittable during \(phase)")
    XCTAssertTrue(pair.isHittable, "Pair with my desktop action is not hittable during \(phase)")
    XCTAssertFalse(
      scan.exists,
      "QR scan action must stay behind Pair with my desktop during \(phase)"
    )
    XCTAssertFalse(
      enterCode.exists,
      "enter-code action must stay behind Pair with my desktop during \(phase)"
    )

    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = "landing-\(phase)"
    attachment.lifetime = .keepAlways
    add(attachment)
    print("IOS_RUNTIME_STATE=landing_ok phase=\(phase)")
  }
}
