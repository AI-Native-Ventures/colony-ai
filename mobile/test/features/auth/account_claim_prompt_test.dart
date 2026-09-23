import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/features/auth/account_auth_types.dart';
import 'package:buzz/features/auth/account_claim_prompt.dart';
import 'package:buzz/features/auth/account_claim_status_provider.dart';
import 'package:buzz/features/auth/claim_account_page.dart';

import '../../helpers/widget_helpers.dart';

void main() {
  testWidgets('unlinked identity gets a persistent claim action', (
    tester,
  ) async {
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          accountLinkStatusProvider.overrideWith(
            () => _FakeLinkStatusNotifier(AccountLinkStatus.needsClaim),
          ),
        ],
        child: const AccountClaimPrompt(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Add an account'), findsOneWidget);
    expect(
      find.text('Add email sign-in so you can get back into this identity.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Set up'));
    await tester.pumpAndSettle();
    expect(find.byType(ClaimAccountPage), findsOneWidget);
  });

  testWidgets('unreachable status offers retry and keeps local use available', (
    tester,
  ) async {
    var buildCount = 0;
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          accountLinkStatusProvider.overrideWith(
            () => _CountingLinkStatusNotifier(
              AccountLinkStatus.tryAgainLater,
              onBuild: () => buildCount++,
            ),
          ),
        ],
        child: const AccountClaimPrompt(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Account connection unavailable'), findsOneWidget);
    expect(
      find.text('Try again later. You can keep using the app.'),
      findsOneWidget,
    );
    expect(find.text('Try again'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(buildCount, greaterThan(1));
    expect(find.text('Account connection unavailable'), findsOneWidget);
  });

  testWidgets('linked identity has no claim prompt', (tester) async {
    await tester.pumpWidget(
      WidgetHelpers.testable(
        overrides: [
          accountLinkStatusProvider.overrideWith(
            () => _FakeLinkStatusNotifier(AccountLinkStatus.linked),
          ),
        ],
        child: const AccountClaimPrompt(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Add an account'), findsNothing);
    expect(find.text('Account connection unavailable'), findsNothing);
    expect(find.text('Set up'), findsNothing);
  });
}

class _FakeLinkStatusNotifier extends AccountLinkStatusNotifier {
  _FakeLinkStatusNotifier(this.status);

  final AccountLinkStatus status;

  @override
  Future<AccountLinkState> build() async => AccountLinkState(status);
}

class _CountingLinkStatusNotifier extends AccountLinkStatusNotifier {
  _CountingLinkStatusNotifier(this.status, {required this.onBuild});

  final AccountLinkStatus status;
  final VoidCallback onBuild;

  @override
  Future<AccountLinkState> build() async {
    onBuild();
    return AccountLinkState(status);
  }
}
