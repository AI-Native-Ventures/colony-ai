import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'credits_api.dart';

class CreditsBalancePage extends ConsumerWidget {
  const CreditsBalancePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(creditsOverviewProvider);
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Colony credits'),
      body: overview.when(
        loading: () => const Center(
          child: CircularProgressIndicator(semanticsLabel: 'Loading credits'),
        ),
        error: (error, _) => _CreditsUnavailable(
          failure: error,
          onRetry: () => ref.invalidate(creditsOverviewProvider),
        ),
        data: (data) => _CreditsBalanceContent(overview: data),
      ),
    );
  }
}

class _CreditsBalanceContent extends StatelessWidget {
  const _CreditsBalanceContent({required this.overview});

  final CreditsOverview overview;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(21, 25, 21, 25),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: Theme.of(context).brightness == Brightness.dark
                  ? const [Color(0xFF49375C), Color(0xFF513D46)]
                  : const [Color(0xFFE5D6E9), Color(0xFFEFDDD1)],
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'AI SPEND & POWER',
                style: context.mobileTypography.metadata.copyWith(
                  color: tokens.ink,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
              const SizedBox(height: Grid.xs),
              Text(
                'Keep good\nwork moving.',
                style: context.mobileTypography.companyHubTitle.copyWith(
                  color: tokens.ink,
                  fontSize: 24,
                  height: 1.1,
                  letterSpacing: -0.7,
                ),
              ),
              const SizedBox(height: Grid.xs),
              Text(
                'Your balance and usage, with every debit accounted for.',
                style: context.mobileTypography.conversation.copyWith(
                  color: tokens.ink,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Grid.md),
        Container(
          padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
          decoration: BoxDecoration(
            color: tokens.soft,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'AVAILABLE BALANCE',
                style: context.mobileTypography.metadata.copyWith(
                  color: tokens.muted,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.3,
                ),
              ),
              const SizedBox(height: Grid.xs),
              Text(
                _money(overview.balanceUsdCents, 'USD'),
                key: const ValueKey('credits-balance-usd'),
                style: context.mobileTypography.companyHubTitle.copyWith(
                  color: tokens.ink,
                  fontSize: 38,
                  fontWeight: FontWeight.w500,
                  letterSpacing: -1.4,
                ),
              ),
              const SizedBox(height: Grid.xxs),
              Text(
                'Shared business balance',
                style: context.mobileTypography.conversation.copyWith(
                  color: tokens.muted,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: Grid.md),
        _CreditsLinkRow(
          icon: LucideIcons.arrowLeftRight,
          title: 'Usage & payments',
          subtitle: overview.ledger.isEmpty
              ? 'View usage and payment history'
              : 'A traceable record of every change',
          onPressed: (context) => Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => CreditsActivityPage(overview: overview),
            ),
          ),
        ),
        _CreditsLinkRow(
          icon: LucideIcons.chartNoAxesCombined,
          title: 'Usage this month',
          subtitle: overview.currentMonth.month.isEmpty
              ? 'Current monthly usage'
              : _monthLabel(overview.currentMonth.month),
          trailing: _money(overview.currentMonth.spentUsdCents, 'USD'),
          onPressed: (context) => Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => CreditsUsagePage(overview: overview),
            ),
          ),
        ),
      ],
    );
  }
}

class CreditsActivityPage extends StatelessWidget {
  const CreditsActivityPage({required this.overview, super.key});

  final CreditsOverview overview;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Scaffold(
      backgroundColor: tokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Credit activity'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        children: [
          if (overview.ledger.isNotEmpty) ...[
            for (final entry in overview.ledger)
              _CreditsActivityRow(
                title: entry.description.isEmpty
                    ? _humanize(entry.type)
                    : entry.description,
                subtitle: DateFormat.yMMMd().format(entry.createdAt.toLocal()),
                amount: _signedMoney(entry.amountUsdCents, 'USD'),
              ),
          ],
          if (overview.paymentIntents.isNotEmpty) ...[
            const SizedBox(height: Grid.md),
            Padding(
              padding: const EdgeInsets.fromLTRB(2, 8, 2, 4),
              child: Text(
                'PAYFAST PAYMENTS',
                style: context.mobileTypography.metadata.copyWith(
                  color: tokens.muted,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
            ),
            for (final intent in overview.paymentIntents)
              _CreditsActivityRow(
                title: _humanize(intent.status),
                subtitle:
                    '${DateFormat.yMMMd().format(intent.createdAt.toLocal())} · ${_money(intent.grantUsdCents, 'USD')} credits',
                amount: _money(intent.amountZarCents, 'ZAR'),
              ),
          ],
          if (overview.ledger.isEmpty && overview.paymentIntents.isEmpty)
            const SizedBox.shrink(),
        ],
      ),
    );
  }
}

class CreditsUsagePage extends StatelessWidget {
  const CreditsUsagePage({required this.overview, super.key});

  final CreditsOverview overview;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Scaffold(
      backgroundColor: tokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Monthly usage'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        children: [
          for (final month in overview.months)
            _CreditsActivityRow(
              title: _monthLabel(month.month),
              subtitle: '${month.entryCount} ledger entries',
              amount: _signedMoney(-month.spentUsdCents, 'USD'),
            ),
        ],
      ),
    );
  }
}

class _CreditsLinkRow extends StatelessWidget {
  const _CreditsLinkRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onPressed,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final ValueChanged<BuildContext> onPressed;
  final String? trailing;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Semantics(
      button: true,
      label: '$title, $subtitle',
      onTap: () => onPressed(context),
      child: ExcludeSemantics(
        child: InkWell(
          onTap: () => onPressed(context),
          child: Container(
            constraints: const BoxConstraints(minHeight: 72),
            decoration: BoxDecoration(
              border: Border(bottom: BorderSide(color: tokens.line)),
            ),
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        title,
                        style: context.mobileTypography.conversation.copyWith(
                          color: tokens.ink,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        subtitle,
                        style: context.mobileTypography.metadata.copyWith(
                          color: tokens.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (trailing != null)
                  Text(
                    trailing!,
                    style: context.mobileTypography.metadata.copyWith(
                      color: tokens.ink,
                      fontWeight: FontWeight.w600,
                    ),
                  )
                else
                  Icon(LucideIcons.arrowRight, size: 17, color: tokens.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CreditsActivityRow extends StatelessWidget {
  const _CreditsActivityRow({
    required this.title,
    required this.subtitle,
    required this.amount,
  });

  final String title;
  final String subtitle;
  final String amount;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      constraints: const BoxConstraints(minHeight: 68),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      padding: const EdgeInsets.symmetric(vertical: 13),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.conversation.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.muted,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: Grid.sm),
          Text(
            amount,
            style: context.mobileTypography.metadata.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _CreditsUnavailable extends StatelessWidget {
  const _CreditsUnavailable({required this.failure, required this.onRetry});

  final Object failure;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final message = switch (failure) {
      CreditsFailure(kind: CreditsFailureKind.accountNotLinked) =>
        'Link an account to view credits.',
      CreditsFailure(kind: CreditsFailureKind.identityUnavailable) =>
        'Connect an identity to view credits.',
      _ => 'Credits are temporarily unavailable.',
    };
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Grid.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(LucideIcons.walletCards, size: 32, color: tokens.muted),
            const SizedBox(height: Grid.sm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: context.mobileTypography.conversation.copyWith(
                color: tokens.ink,
              ),
            ),
            if (failure is! CreditsFailure ||
                (failure as CreditsFailure).kind ==
                    CreditsFailureKind.unavailable) ...[
              const SizedBox(height: Grid.sm),
              TextButton(
                key: const ValueKey('credits-retry'),
                onPressed: onRetry,
                style: TextButton.styleFrom(foregroundColor: tokens.action),
                child: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

String _money(int cents, String currency) {
  final amount = cents / 100;
  return '$currency ${NumberFormat('#,##0.00').format(amount)}';
}

String _signedMoney(int cents, String currency) {
  final sign = cents < 0 ? '− ' : '+ ';
  return '$sign${_money(cents.abs(), currency)}';
}

String _monthLabel(String month) {
  if (month.isEmpty) return 'Monthly usage';
  final parts = month.split('-');
  final date = DateTime(int.parse(parts[0]), int.parse(parts[1]));
  return DateFormat.yMMMM().format(date);
}

String _humanize(String value) => value
    .split(RegExp(r'[_\s]+'))
    .where((word) => word.isNotEmpty)
    .map((word) => '${word[0].toUpperCase()}${word.substring(1)}')
    .join(' ');
