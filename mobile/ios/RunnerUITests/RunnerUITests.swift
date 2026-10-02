import CoreGraphics
import XCTest
import UIKit
import Vision

final class RunnerUITests: XCTestCase {
  private let landingReadyTimeout: TimeInterval = 60
  private let elementReadyTimeout: TimeInterval = 15

  func testLandingSurvivesTerminateAndRelaunch() {
    guard let appIdentifier = testAppBundleIdentifier() else { return }

    let app = XCUIApplication(bundleIdentifier: appIdentifier)
    var launchRetryUsed = false

    guard assertAccountLanding(in: app, phase: "initial", launchRetryUsed: &launchRetryUsed) else {
      return
    }

    let pair = app.buttons["Pair with my desktop"]
    guard waitUntilHittable(pair, timeout: elementReadyTimeout) else {
      attachFailureEvidence(from: app, name: "pairing-entry-not-hittable")
      XCTFail("Pair with my desktop action was not hittable on the account screen")
      return
    }

    pair.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

    let scan = app.buttons["Scan QR code"]
    guard scan.waitForExistence(timeout: elementReadyTimeout) else {
      attachFailureEvidence(from: app, name: "pairing-start-not-reached")
      XCTFail("Pair with my desktop did not open the pairing start screen")
      return
    }

    let enterCode = app.buttons["Enter a code instead"]
    guard enterCode.exists else {
      attachFailureEvidence(from: app, name: "pairing-code-action-missing")
      XCTFail("Enter a code instead action was missing on the pairing start screen")
      return
    }
    guard waitUntilHittable(scan, timeout: elementReadyTimeout) else {
      attachFailureEvidence(from: app, name: "pairing-scan-not-hittable")
      XCTFail("Scan QR code action was not hittable on the pairing start screen")
      return
    }
    guard waitUntilHittable(enterCode, timeout: elementReadyTimeout) else {
      attachFailureEvidence(from: app, name: "pairing-code-not-hittable")
      XCTFail("Enter a code instead action was not hittable on the pairing start screen")
      return
    }
    guard !app.buttons["Create an account"].exists else {
      attachFailureEvidence(from: app, name: "account-actions-remained-visible")
      XCTFail("Account actions remained visible after opening pairing")
      return
    }

    let pairingAttachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    pairingAttachment.name = "landing-pairing-start"
    pairingAttachment.lifetime = .keepAlways
    add(pairingAttachment)

    app.terminate()
    guard app.state == .notRunning else {
      attachFailureEvidence(from: app, name: "app-did-not-terminate")
      XCTFail("App did not terminate cleanly")
      return
    }

    guard assertAccountLanding(in: app, phase: "relaunch", launchRetryUsed: &launchRetryUsed) else {
      return
    }
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

    guard value != "ventures.ainative.colony" else {
      XCTFail("runtime proof must not target the release bundle identifier")
      return nil
    }
    return value
  }

  private func assertAccountLanding(
    in app: XCUIApplication,
    phase: String,
    launchRetryUsed: inout Bool
  ) -> Bool {
    app.launch()

    let createAccount = app.buttons["Create an account"]
    if !createAccount.waitForExistence(timeout: landingReadyTimeout) {
      guard app.state == .notRunning && !launchRetryUsed else {
        attachFailureEvidence(from: app, name: "account-landing-\(phase)-not-ready")
        XCTFail("Account landing did not become ready during \(phase)")
        return false
      }

      launchRetryUsed = true
      print("IOS_RUNTIME_RETRY=app-launch phase=\(phase)")
      app.launch()
      guard createAccount.waitForExistence(timeout: landingReadyTimeout) else {
        attachFailureEvidence(from: app, name: "account-landing-\(phase)-retry-not-ready")
        XCTFail("Account landing did not become ready during \(phase) after one launch retry")
        return false
      }
    }

    guard app.state == .runningForeground else {
      attachFailureEvidence(from: app, name: "account-landing-\(phase)-not-foreground")
      XCTFail("App did not remain in the foreground during \(phase)")
      return false
    }

    let signIn = app.buttons["I already have an account"]
    let pair = app.buttons["Pair with my desktop"]
    guard signIn.exists && pair.exists else {
      attachFailureEvidence(from: app, name: "account-landing-\(phase)-actions-missing")
      XCTFail("Account landing actions were incomplete during \(phase)")
      return false
    }
    guard waitUntilHittable(createAccount, timeout: elementReadyTimeout) else {
      attachFailureEvidence(from: app, name: "account-landing-\(phase)-create-not-hittable")
      XCTFail("Create an account action was not hittable during \(phase)")
      return false
    }
    guard waitUntilHittable(signIn, timeout: elementReadyTimeout) else {
      attachFailureEvidence(from: app, name: "account-landing-\(phase)-sign-in-not-hittable")
      XCTFail("Sign-in action was not hittable during \(phase)")
      return false
    }
    guard waitUntilHittable(pair, timeout: elementReadyTimeout) else {
      attachFailureEvidence(from: app, name: "account-landing-\(phase)-pair-not-hittable")
      XCTFail("Pair with my desktop action was not hittable during \(phase)")
      return false
    }

    let screenshot = XCUIScreen.main.screenshot()
    guard screenshotContains("A HOME FOR YOUR BUSINESS", in: screenshot) else {
      attachFailureEvidence(from: app, name: "account-landing-\(phase)-eyebrow-not-visible")
      XCTFail("Account landing eyebrow was not visible during \(phase)")
      return false
    }
    guard !app.buttons["Scan QR code"].exists && !app.buttons["Enter a code instead"].exists else {
      attachFailureEvidence(from: app, name: "account-landing-\(phase)-pairing-actions-visible")
      XCTFail("Pairing actions were visible before opening pairing during \(phase)")
      return false
    }

    let attachment = XCTAttachment(screenshot: screenshot)
    attachment.name = "landing-\(phase)"
    attachment.lifetime = .keepAlways
    add(attachment)
    print("IOS_RUNTIME_STATE=landing_ok phase=\(phase)")
    return true
  }

  private func waitUntilHittable(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
    let predicate = NSPredicate(format: "exists == true AND hittable == true")
    let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element)
    return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
  }

  private func screenshotContains(_ text: String, in screenshot: XCUIScreenshot) -> Bool {
    guard let image = screenshot.image.cgImage else { return false }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.recognitionLanguages = ["en-US"]

    do {
      try VNImageRequestHandler(cgImage: image).perform([request])
    } catch {
      return false
    }

    let expected = normalizeRecognizedText(text)
    return request.results?.contains { observation in
      guard let candidate = observation.topCandidates(1).first?.string else { return false }
      return normalizeRecognizedText(candidate).contains(expected)
    } ?? false
  }

  private func normalizeRecognizedText(_ text: String) -> String {
    text
      .split(whereSeparator: { $0.isWhitespace })
      .joined(separator: " ")
      .uppercased()
  }

  private func attachFailureEvidence(from app: XCUIApplication, name: String) {
    let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    screenshot.name = "\(name)-screenshot"
    screenshot.lifetime = .keepAlways
    add(screenshot)

    let tree = XCTAttachment(string: String(app.debugDescription.prefix(32_768)))
    tree.name = "\(name)-accessibility-tree"
    tree.lifetime = .keepAlways
    add(tree)
  }
}
