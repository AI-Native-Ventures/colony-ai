part of '../pairing_mobile_page.dart';

class _PairingSuccessBadge extends ConsumerWidget {
  const _PairingSuccessBadge();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final initials = community == null
        ? 'c'
        : _profileInitials(community.name).toLowerCase();
    return CircleAvatar(
      radius: 16,
      backgroundColor: const Color(0xffe4ede5),
      foregroundColor: const Color(0xff63826c),
      child: ExcludeSemantics(
        child: Text(
          initials,
          style: context.mobileTypography.metadata.copyWith(
            color: const Color(0xff63826c),
            fontSize: 9,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _PairingSuccessView extends HookConsumerWidget {
  const _PairingSuccessView();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tokens = context.mobileTokens;
    final successInk = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xffa6cbb4)
        : const Color(0xff537c65);
    final active = ref.watch(activeCommunityProvider).asData?.value;
    final pubkey = active?.pubkey?.toLowerCase();
    final profiles = ref.watch(userCacheProvider);
    final profile = pubkey == null ? null : profiles[pubkey];

    useEffect(() {
      if (pubkey != null && profile == null) {
        ref.read(userCacheProvider.notifier).get(pubkey);
      }
      return null;
    }, [pubkey, profile]);

    final displayName = profile?.label ?? 'Your Colony identity';
    final secondary = active?.name ?? 'Existing Colony identity';
    return _PairingContent(
      topPadding: 36,
      children: [
        ExcludeSemantics(
          child: Container(
            width: 62,
            height: 62,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: Color(0x206b9c82),
              shape: BoxShape.circle,
            ),
            child: CustomPaint(
              size: const Size(20, 20),
              painter: _PairingSuccessCheck(successInk),
            ),
          ),
        ),
        const SizedBox(height: 24),
        Semantics(
          header: true,
          child: Text(
            'You’re connected.',
            style: context.mobileTypography.flowTitle.copyWith(
              color: tokens.ink,
              fontSize: 28,
              fontWeight: FontWeight.w700,
              letterSpacing: -1.1,
              height: 1.13,
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'This phone now uses your existing Colony identity.',
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.muted,
            fontSize: 13,
            height: 1.7,
          ),
        ),
        const SizedBox(height: 24),
        _PairingIdentityRow(
          displayName: displayName,
          subtitle: secondary,
          initials: profile == null ? 'C' : _profileInitials(displayName),
        ),
        const SizedBox(height: 24),
        Text(
          'Your businesses and conversations are ready. Manage paired devices in Settings.',
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.muted,
            fontSize: 12,
            height: 1.65,
          ),
        ),
      ],
    );
  }
}

class _PairingIdentityRow extends StatelessWidget {
  const _PairingIdentityRow({
    required this.displayName,
    required this.subtitle,
    required this.initials,
  });

  final String displayName;
  final String subtitle;
  final String initials;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18),
      decoration: BoxDecoration(
        border: Border.symmetric(horizontal: BorderSide(color: tokens.line)),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0x20a688bb),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              initials,
              style: context.mobileTypography.metadata.copyWith(
                color: tokens.ink,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  displayName,
                  style: context.mobileTypography.conversation.copyWith(
                    color: tokens.ink,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  subtitle,
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.muted,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _profileInitials(String label) {
  final words = label
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty);
  if (words.isEmpty) return 'C';
  final initials = words.take(2).map((word) => word.characters.first).join();
  return initials.toUpperCase();
}

class _PairingOutcomeView extends StatelessWidget {
  const _PairingOutcomeView({required this.route});

  final PairingMobileRoute route;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final failureInk = Theme.of(context).brightness == Brightness.dark
        ? const Color(0xffddb681)
        : const Color(0xffa47a44);
    final details = switch (route) {
      PairingMobileRoute.failed => (
        'Couldn’t finish pairing.',
        'The connection to your desktop was interrupted. No identity was linked.',
        'Your existing desktop identity is unchanged.',
        '!',
      ),
      PairingMobileRoute.expired => (
        'This code has expired.',
        'Ask your desktop for a new QR or pairing code, then try again.',
        'Your existing desktop identity is unchanged.',
        '!',
      ),
      PairingMobileRoute.cancelled => (
        'Pairing cancelled.',
        'This phone was not linked. You can start again whenever you’re ready.',
        'Your existing desktop identity is unchanged.',
        '×',
      ),
      PairingMobileRoute.mismatch => (
        'Don’t approve this pairing.',
        'The confirmation codes are different. Cancel on both devices and start a fresh pairing session.',
        'Your existing desktop identity is unchanged.',
        '!',
      ),
      _ => throw StateError('Outcome view requires a terminal pairing route.'),
    };

    return _PairingContent(
      children: [
        Container(
          width: 62,
          height: 62,
          alignment: Alignment.center,
          decoration: const BoxDecoration(
            color: Color(0x20c69154),
            shape: BoxShape.circle,
          ),
          child: Text(
            details.$4,
            style: context.mobileTypography.body.copyWith(
              color: failureInk,
              fontSize: 27,
              height: 1,
            ),
          ),
        ),
        const SizedBox(height: 24),
        Semantics(
          header: true,
          child: Text(
            details.$1,
            style: context.mobileTypography.flowTitle.copyWith(
              color: tokens.ink,
              fontSize: 28,
              fontWeight: FontWeight.w700,
              letterSpacing: -1.1,
              height: 1.13,
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          details.$2,
          style: context.mobileTypography.conversation.copyWith(
            color: tokens.muted,
            fontSize: 13,
            height: 1.7,
          ),
        ),
        const SizedBox(height: 20),
        Text(
          details.$3,
          style: context.mobileTypography.metadata.copyWith(
            color: tokens.muted,
            fontSize: 12,
            height: 1.65,
          ),
        ),
      ],
    );
  }
}

class _PairingSuccessCheck extends CustomPainter {
  const _PairingSuccessCheck(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.8
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    final path = Path()
      ..moveTo(size.width * 0.18, size.height * 0.52)
      ..lineTo(size.width * 0.42, size.height * 0.76)
      ..lineTo(size.width * 0.84, size.height * 0.25);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_PairingSuccessCheck oldDelegate) =>
      oldDelegate.color != color;
}
