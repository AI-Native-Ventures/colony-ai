import 'package:buzz/shared/identity/identity_components.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/widgets/avatar_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';

void main() {
  testWidgets('uses distinct person and agent avatar shapes', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const Row(
            children: [
              IdentityAvatar(initials: 'LM', kind: IdentityKind.person),
              IdentityAvatar(initials: 'M', kind: IdentityKind.agent),
            ],
          ),
        ),
      ),
    );

    final avatars = tester.widgetList<AvatarImage>(find.byType(AvatarImage));
    expect(avatars.map((avatar) => avatar.isAgent), [false, true]);
    expect(find.byType(CircleAvatar), findsOneWidget);
    expect(find.text('LM'), findsOneWidget);
    expect(find.text('M'), findsOneWidget);
  });

  testWidgets('exposes each identity row as one accessible action', (
    tester,
  ) async {
    var tapped = false;
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: IdentityRow(
              name: 'Mina',
              details: 'Social Media Manager',
              initials: 'M',
              kind: IdentityKind.agent,
              status: 'Working',
              isOnline: true,
              onTap: () => tapped = true,
            ),
          ),
        ),
      ),
    );

    expect(
      find.bySemanticsLabel('Mina, Social Media Manager, AI agent, Working'),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('M'), findsNothing);

    await tester.tap(
      find.bySemanticsLabel('Mina, Social Media Manager, AI agent, Working'),
    );
    expect(tapped, isTrue);
    semantics.dispose();
  });

  testWidgets('exposes a non-action identity row as one semantic label', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: const IdentityRow(
            name: 'Mina',
            details: 'Social Media Manager',
            initials: 'M',
            kind: IdentityKind.agent,
            status: 'Working',
          ),
        ),
      ),
    );

    expect(
      find.bySemanticsLabel('Mina, Social Media Manager, AI agent, Working'),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('M'), findsNothing);
    semantics.dispose();
  });
}
