import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/profile/user_cache_provider.dart';
import '../../shared/theme/theme.dart';
import 'pairing_provider.dart';
import 'pairing_qr_scanner.dart';

part 'pairing_mobile_page/entry_views.dart';
part 'pairing_mobile_page/session_views.dart';
part 'pairing_mobile_page/outcome_views.dart';

const _pairingActionColor = Color(0xff45669f);
const _pairingWaitingColor = Color(0xff9580b0);

Color _pairingLinkColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
    ? const Color(0xffa1bce9)
    : const Color(0xff345c99);

/// One route in the existing-identity phone pairing flow.
enum PairingMobileRoute {
  start,
  scan,
  manual,
  cameraDenied,
  compare,
  waiting,
  success,
  failed,
  expired,
  cancelled,
  mismatch,
}

/// Builds the camera preview used by the pairing QR scanner.
typedef PairingCameraPreviewBuilder = Widget Function(BuildContext context);

/// Mobile screens for linking this phone to an existing desktop identity.
class PairingMobilePage extends HookConsumerWidget {
  /// The initial screen, exposed to widget tests for visual route proof.
  @visibleForTesting
  final PairingMobileRoute initialRoute;

  /// Clears previous pairing state before starting the account-entry flow.
  final bool startFresh;

  /// Replaces the device camera with a test-only preview fixture.
  @visibleForTesting
  final PairingCameraPreviewBuilder? cameraPreviewBuilder;

  const PairingMobilePage({
    @visibleForTesting this.initialRoute = PairingMobileRoute.start,
    this.startFresh = false,
    this.cameraPreviewBuilder,
    super.key,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pairing = ref.watch(pairingProvider);
    final route = useState(initialRoute);
    final codeController = useTextEditingController();
    final cameraErrorHandled = useRef(false);
    final tokens = context.mobileTokens;

    useEffect(() {
      if (route.value == PairingMobileRoute.scan) {
        cameraErrorHandled.value = false;
      }
      return null;
    }, [route.value]);

    useEffect(() {
      if (startFresh) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted) ref.read(pairingProvider.notifier).reset();
        });
      }
      return null;
    }, [startFresh]);

    ref.listen<PairingState>(pairingProvider, (previous, next) {
      if (next.status == PairingStatus.confirmingSas && next.sasCode != null) {
        route.value = next.userConfirmedSas
            ? PairingMobileRoute.waiting
            : PairingMobileRoute.compare;
      } else if (next.status == PairingStatus.transferring ||
          next.status == PairingStatus.storing) {
        route.value = PairingMobileRoute.waiting;
      } else if (next.status == PairingStatus.success) {
        route.value = PairingMobileRoute.success;
      } else if (next.status == PairingStatus.error) {
        route.value = switch (next.failureKind) {
          PairingFailureKind.invalidCode => PairingMobileRoute.manual,
          PairingFailureKind.expired => PairingMobileRoute.expired,
          PairingFailureKind.cancelled => PairingMobileRoute.cancelled,
          PairingFailureKind.mismatch => PairingMobileRoute.mismatch,
          PairingFailureKind.connection ||
          PairingFailureKind.transfer ||
          null => PairingMobileRoute.failed,
        };
      }
    });

    final busy =
        pairing.status == PairingStatus.connecting ||
        pairing.status == PairingStatus.transferring ||
        pairing.status == PairingStatus.storing ||
        pairing.authorizationInProgress;

    void resetToStart() {
      ref.read(pairingProvider.notifier).reset();
      codeController.clear();
      route.value = PairingMobileRoute.start;
    }

    void returnToWelcome() {
      ref.read(pairingProvider.notifier).reset();
      Navigator.of(context).maybePop();
    }

    void openColony() {
      ref.read(pairingProvider.notifier).reset();
      Navigator.of(context).popUntil((route) => route.isFirst);
    }

    void back() {
      if (route.value == PairingMobileRoute.start) {
        Navigator.of(context).maybePop();
        return;
      }
      if (route.value == PairingMobileRoute.cameraDenied) {
        route.value = PairingMobileRoute.scan;
        return;
      }
      if (route.value == PairingMobileRoute.compare ||
          route.value == PairingMobileRoute.waiting) {
        ref.read(pairingProvider.notifier).cancelPairing();
        route.value = PairingMobileRoute.cancelled;
        return;
      }
      resetToStart();
    }

    void submitCode(String value) {
      if (busy) return;
      FocusManager.instance.primaryFocus?.unfocus();
      unawaited(ref.read(pairingProvider.notifier).pairExistingIdentity(value));
    }

    void handleScan(String value) {
      if (!busy) submitCode(value);
    }

    Future<void> openCameraSettings() async {
      await openPairingCameraSettings();
    }

    final activeSession =
        pairing.status == PairingStatus.connecting ||
        pairing.status == PairingStatus.confirmingSas ||
        pairing.status == PairingStatus.transferring ||
        pairing.status == PairingStatus.storing;

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop && activeSession) {
          ref.read(pairingProvider.notifier).cancelPairing();
        }
      },
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness:
              Theme.of(context).brightness == Brightness.dark
              ? Brightness.light
              : Brightness.dark,
          statusBarBrightness: Theme.of(context).brightness,
        ),
        child: Scaffold(
          backgroundColor: tokens.paper,
          appBar: AppBar(
            backgroundColor: tokens.paper,
            foregroundColor: tokens.ink,
            elevation: 0,
            scrolledUnderElevation: 0,
            toolbarHeight: 66,
            leadingWidth: route.value == PairingMobileRoute.success ? 52 : 56,
            leading: route.value == PairingMobileRoute.success
                ? Padding(
                    padding: const EdgeInsets.only(left: 16, right: 4),
                    child: const _PairingSuccessBadge(),
                  )
                : IconButton(
                    tooltip: 'Back',
                    onPressed: back,
                    icon: const Icon(Icons.chevron_left),
                  ),
            automaticallyImplyLeading: false,
            titleSpacing: route.value == PairingMobileRoute.success ? 6 : 12,
            title: Text(
              _pairingRouteTitle(route.value),
              style: context.textTheme.titleSmall?.copyWith(
                color: tokens.ink,
                fontWeight: FontWeight.w700,
                fontSize: 16,
                letterSpacing: -0.4,
              ),
            ),
            bottom: PreferredSize(
              preferredSize: const Size.fromHeight(1),
              child: Divider(height: 1, color: tokens.line),
            ),
          ),
          body: SafeArea(
            top: false,
            child: _pairingRouteBody(
              route: route.value,
              pairing: pairing,
              codeController: codeController,
              busy: busy,
              cameraPreviewBuilder: cameraPreviewBuilder,
              onRouteChanged: (next) => route.value = next,
              onCameraError: (error) {
                if (!context.mounted || cameraErrorHandled.value) return;
                cameraErrorHandled.value = true;
                route.value =
                    error.errorCode == MobileScannerErrorCode.permissionDenied
                    ? PairingMobileRoute.cameraDenied
                    : PairingMobileRoute.manual;
              },
              onScan: handleScan,
              onTextChanged: () {
                if (pairing.failureKind == PairingFailureKind.invalidCode) {
                  ref.read(pairingProvider.notifier).reset();
                }
              },
            ),
          ),
          bottomNavigationBar: _pairingRouteFooter(
            context: context,
            route: route.value,
            codeController: codeController,
            busy: busy,
            onRouteChanged: (next) => route.value = next,
            onSubmit: submitCode,
            onConfirmSas: () {
              ref.read(pairingProvider.notifier).confirmSas();
              route.value = PairingMobileRoute.waiting;
            },
            onDenySas: () => ref.read(pairingProvider.notifier).denySas(),
            onOpenSettings: () => unawaited(openCameraSettings()),
            onCancel: () {
              ref.read(pairingProvider.notifier).cancelPairing();
              route.value = PairingMobileRoute.cancelled;
            },
            onStartAgain: resetToStart,
            onBackToWelcome: returnToWelcome,
            onOpenColony: openColony,
          ),
        ),
      ),
    );
  }
}

String _pairingRouteTitle(PairingMobileRoute route) => switch (route) {
  PairingMobileRoute.start => 'Pair with your desktop',
  PairingMobileRoute.scan => 'Scan desktop QR',
  PairingMobileRoute.manual => 'Enter pairing code',
  PairingMobileRoute.cameraDenied => 'Camera access is off',
  PairingMobileRoute.compare => 'Compare both devices',
  PairingMobileRoute.waiting => 'Waiting for desktop',
  PairingMobileRoute.success => 'Phone paired',
  PairingMobileRoute.failed => 'Pairing failed',
  PairingMobileRoute.expired => 'Pairing code expired',
  PairingMobileRoute.cancelled => 'Pairing cancelled',
  PairingMobileRoute.mismatch => 'Codes do not match',
};

Widget _pairingRouteBody({
  required PairingMobileRoute route,
  required PairingState pairing,
  required TextEditingController codeController,
  required bool busy,
  required PairingCameraPreviewBuilder? cameraPreviewBuilder,
  required ValueChanged<PairingMobileRoute> onRouteChanged,
  required ValueChanged<MobileScannerException> onCameraError,
  required ValueChanged<String> onScan,
  required VoidCallback onTextChanged,
}) => switch (route) {
  PairingMobileRoute.start => _PairingStartView(),
  PairingMobileRoute.scan => _PairingScanView(
    onCameraError: onCameraError,
    onScan: onScan,
    cameraPreviewBuilder: cameraPreviewBuilder,
  ),
  PairingMobileRoute.manual => _PairingManualView(
    controller: codeController,
    errorMessage: pairing.failureKind == PairingFailureKind.invalidCode
        ? pairing.errorMessage
        : null,
    busy: busy,
    onChanged: onTextChanged,
  ),
  PairingMobileRoute.cameraDenied => const _PairingCameraDeniedView(),
  PairingMobileRoute.compare => _PairingCompareView(pairing: pairing),
  PairingMobileRoute.waiting => _PairingWaitingView(pairing: pairing),
  PairingMobileRoute.success => const _PairingSuccessView(),
  PairingMobileRoute.failed => const _PairingOutcomeView(
    route: PairingMobileRoute.failed,
  ),
  PairingMobileRoute.expired => const _PairingOutcomeView(
    route: PairingMobileRoute.expired,
  ),
  PairingMobileRoute.cancelled => const _PairingOutcomeView(
    route: PairingMobileRoute.cancelled,
  ),
  PairingMobileRoute.mismatch => const _PairingOutcomeView(
    route: PairingMobileRoute.mismatch,
  ),
};

Widget _pairingRouteFooter({
  required BuildContext context,
  required PairingMobileRoute route,
  required TextEditingController codeController,
  required bool busy,
  required ValueChanged<PairingMobileRoute> onRouteChanged,
  required ValueChanged<String> onSubmit,
  required VoidCallback onConfirmSas,
  required VoidCallback onDenySas,
  required VoidCallback onOpenSettings,
  required VoidCallback onCancel,
  required VoidCallback onStartAgain,
  required VoidCallback onBackToWelcome,
  required VoidCallback onOpenColony,
}) {
  final tokens = context.mobileTokens;
  Widget primary(String label, VoidCallback? onPressed) => SizedBox(
    height: 44,
    width: double.infinity,
    child: FilledButton(
      onPressed: onPressed,
      style: FilledButton.styleFrom(
        backgroundColor: _pairingActionColor,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.button),
        ),
      ),
      child: Text(label),
    ),
  );
  Widget secondary(String label, VoidCallback? onPressed) => SizedBox(
    height: 44,
    width: double.infinity,
    child: TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: _pairingLinkColor(context),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.button),
        ),
      ),
      child: Text(label),
    ),
  );
  Widget softAction(String label, VoidCallback? onPressed) => SizedBox(
    height: 44,
    width: double.infinity,
    child: TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: tokens.ink,
        backgroundColor: tokens.soft,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.button),
        ),
      ),
      child: Text(label),
    ),
  );

  final children = switch (route) {
    PairingMobileRoute.start => [
      primary('Scan QR code', () => onRouteChanged(PairingMobileRoute.scan)),
      const SizedBox(height: 4),
      secondary(
        'Enter a code instead',
        () => onRouteChanged(PairingMobileRoute.manual),
      ),
    ],
    PairingMobileRoute.scan => [
      softAction(
        'Enter code manually',
        busy ? null : () => onRouteChanged(PairingMobileRoute.manual),
      ),
    ],
    PairingMobileRoute.manual => [
      primary('Continue', busy ? null : () => onSubmit(codeController.text)),
      const SizedBox(height: 4),
      secondary(
        'Scan QR instead',
        busy ? null : () => onRouteChanged(PairingMobileRoute.scan),
      ),
    ],
    PairingMobileRoute.cameraDenied => [
      primary(
        'Enter a code instead',
        () => onRouteChanged(PairingMobileRoute.manual),
      ),
      const SizedBox(height: 4),
      secondary('Open camera settings', onOpenSettings),
    ],
    PairingMobileRoute.compare => [
      primary('Yes, the codes match', onConfirmSas),
      const SizedBox(height: 4),
      secondary('The codes don’t match', onDenySas),
    ],
    PairingMobileRoute.waiting => [softAction('Cancel pairing', onCancel)],
    PairingMobileRoute.success => [primary('Open Colony', onOpenColony)],
    PairingMobileRoute.failed ||
    PairingMobileRoute.expired ||
    PairingMobileRoute.cancelled ||
    PairingMobileRoute.mismatch => [
      primary('Start again', onStartAgain),
      const SizedBox(height: 4),
      secondary('Back to welcome', onBackToWelcome),
    ],
  };

  return SafeArea(
    top: false,
    child: Container(
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border(top: BorderSide(color: tokens.line)),
      ),
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(mainAxisSize: MainAxisSize.min, children: children),
    ),
  );
}
