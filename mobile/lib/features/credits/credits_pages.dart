import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../shared/community/community_provider.dart';
import '../../shared/theme/theme.dart';
import '../../shared/widgets/mobile_flow_app_bar.dart';
import 'credits_api.dart';

class CreditsBalancePage extends ConsumerWidget {
  const CreditsBalancePage({this.communityName, super.key});

  final String? communityName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final overview = ref.watch(creditsOverviewProvider);
    final failure = overview.asError?.error;
    final isUnavailable =
        failure is CreditsFailure &&
        failure.kind == CreditsFailureKind.unavailable;
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: MobileFlowAppBar(
        title: isUnavailable ? 'Credits' : 'Colony credits',
        subtitle: isUnavailable ? communityName : null,
      ),
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
                title: _paymentIntentLabel(intent, overview),
                subtitle:
                    '${DateFormat.yMMMd().format(intent.createdAt.toLocal())} · ${_money(intent.grantUsdCents, 'USD')} credits',
                amount: _money(intent.amountZarCents, 'ZAR'),
                onPressed: () => Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        CreditsPaymentStatusPage(reference: intent.reference),
                  ),
                ),
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

class CreditsPaymentStatusPage extends ConsumerWidget {
  const CreditsPaymentStatusPage({required this.reference, super.key});

  final String reference;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final community = ref.watch(activeCommunityProvider).asData?.value;
    final intent = ref.watch(creditsPaymentIntentProvider(reference));
    final overview = ref.watch(creditsOverviewProvider);
    void onRetry() {
      ref.invalidate(creditsPaymentIntentProvider(reference));
      ref.invalidate(creditsOverviewProvider);
    }

    final payment = intent.asData?.value;
    final credits = overview.asData?.value;
    final isLoading = intent.isLoading || overview.isLoading;
    final failed = intent.hasError || overview.hasError;
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: MobileFlowAppBar(
        title: 'Add Colony credits',
        subtitle: community?.name,
        compact: true,
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(
                semanticsLabel: 'Checking payment status',
              ),
            )
          : failed || payment == null || credits == null
          ? _CreditsPaymentUnavailable(onRetry: onRetry)
          : _CreditsPaymentStatusContent(
              payment: payment,
              overview: credits,
              onRetry: onRetry,
              onBack: () => Navigator.of(context).pop(),
            ),
    );
  }
}

class _CreditsPaymentStatusContent extends StatelessWidget {
  const _CreditsPaymentStatusContent({
    required this.payment,
    required this.overview,
    required this.onRetry,
    required this.onBack,
  });

  final CreditsPaymentIntent payment;
  final CreditsOverview overview;
  final VoidCallback onRetry;
  final VoidCallback onBack;

  bool get _hasMatchingLedgerEntry => overview.ledger.any(
    (entry) =>
        entry.reference == payment.reference &&
        entry.type == 'purchase' &&
        entry.amountNanoUsd == payment.grantNanoUsd,
  );

  bool get _confirmed => payment.status == 'paid' && _hasMatchingLedgerEntry;

  @override
  Widget build(BuildContext context) {
    if (_confirmed) {
      return _paymentState(
        context,
        eyebrow: 'PAYMENT CONFIRMED',
        title: 'You’re topped up.',
        description: 'The payment record and credit ledger agree.',
        rows: [
          ('Added to balance', _money(payment.grantUsdCents, 'USD')),
          (
            'Paid',
            _money(payment.paidZarCents ?? payment.amountZarCents, 'ZAR'),
          ),
          ('Status', 'Confirmed'),
        ],
        noticeTitle: null,
        noticeDescription: null,
        noticeTone: _CreditsNoticeTone.neutral,
        primaryLabel: 'Back to credits',
        secondaryLabel: null,
        onPrimary: onBack,
        onSecondary: null,
      );
    }

    if (payment.status == 'pending' ||
        payment.status == 'delayed' ||
        payment.status == 'uncertain' ||
        payment.status == 'paid') {
      return _paymentState(
        context,
        eyebrow: 'PAYMENT CHECK',
        title: 'Still waiting for confirmation.',
        description: 'Your browser return is not proof of payment.',
        rows: [
          ('Credits to receive', _money(payment.grantUsdCents, 'USD')),
          ('Payment charge', _money(payment.amountZarCents, 'ZAR')),
          ('Payment provider', 'Payfast'),
        ],
        noticeTitle: 'Credits have not been added yet',
        noticeDescription:
            'We are checking the payment record. Avoid starting a second payment while this one is pending.',
        noticeTone: _CreditsNoticeTone.neutral,
        primaryLabel: 'Check payment status',
        secondaryLabel: 'Return to balance',
        onPrimary: onRetry,
        onSecondary: onBack,
      );
    }

    if (payment.status == 'failed') {
      return _paymentState(
        context,
        eyebrow: 'PAYMENT NOT COMPLETED',
        title: 'Let’s keep it simple.',
        description: 'No credits were added for this attempt.',
        rows: [
          ('Credits to receive', _money(payment.grantUsdCents, 'USD')),
          ('Payment charge', _money(payment.amountZarCents, 'ZAR')),
          ('Payment provider', 'Payfast'),
        ],
        noticeTitle: 'Payment failed',
        noticeDescription:
            'Review the same payment attempt before trying again.',
        noticeTone: _CreditsNoticeTone.error,
        primaryLabel: 'Check payment status',
        secondaryLabel: 'Return to balance',
        onPrimary: onRetry,
        onSecondary: onBack,
        noticeAfterRows: true,
      );
    }

    if (payment.status == 'cancelled') {
      return _paymentState(
        context,
        eyebrow: null,
        title: null,
        description: null,
        rows: const [],
        noticeTitle: 'Payment cancelled',
        noticeDescription:
            'No new credits have been confirmed. If the payment was completed in your browser, check its status before paying again.',
        noticeTone: _CreditsNoticeTone.neutral,
        primaryLabel: 'Check payment',
        secondaryLabel: 'Back to balance',
        onPrimary: onRetry,
        onSecondary: onBack,
      );
    }

    return _paymentState(
      context,
      eyebrow: null,
      title: null,
      description: null,
      rows: const [],
      noticeTitle: 'Payment status unavailable',
      noticeDescription:
          'Your payment may still be processing. We have not marked it failed or asked you to pay again.',
      noticeTone: _CreditsNoticeTone.error,
      primaryLabel: 'Retry status check',
      secondaryLabel: 'Back to credits',
      onPrimary: onRetry,
      onSecondary: onBack,
    );
  }

  Widget _paymentState(
    BuildContext context, {
    required String? eyebrow,
    required String? title,
    required String? description,
    required List<(String, String)> rows,
    required String? noticeTitle,
    required String? noticeDescription,
    required _CreditsNoticeTone noticeTone,
    required String primaryLabel,
    required String? secondaryLabel,
    required VoidCallback onPrimary,
    required VoidCallback? onSecondary,
    bool noticeAfterRows = false,
  }) {
    final tokens = context.mobileTokens;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
      children: [
        if (eyebrow != null && title != null && description != null) ...[
          _CreditsStatusHero(
            eyebrow: eyebrow,
            title: title,
            description: description,
          ),
          const SizedBox(height: Grid.sm),
        ],
        if (!noticeAfterRows &&
            noticeTitle != null &&
            noticeDescription != null) ...[
          _CreditsStatusNotice(
            title: noticeTitle,
            description: noticeDescription,
            tone: noticeTone,
          ),
          const SizedBox(height: Grid.xs),
        ],
        for (final row in rows)
          _CreditsSummaryRow(label: row.$1, value: row.$2),
        if (rows.isNotEmpty) const SizedBox(height: Grid.xs),
        if (noticeAfterRows &&
            noticeTitle != null &&
            noticeDescription != null) ...[
          _CreditsStatusNotice(
            title: noticeTitle,
            description: noticeDescription,
            tone: noticeTone,
          ),
          const SizedBox(height: Grid.xs),
        ],
        SizedBox(
          height: 44,
          child: FilledButton(
            key: const ValueKey('credits-payment-status-check'),
            style: mobileFlowActionButtonStyle(context),
            onPressed: onPrimary,
            child: Text(primaryLabel),
          ),
        ),
        if (secondaryLabel != null && onSecondary != null) ...[
          const SizedBox(height: Grid.xxs),
          SizedBox(
            height: 44,
            child: TextButton(
              style: TextButton.styleFrom(foregroundColor: tokens.action),
              onPressed: onSecondary,
              child: Text(secondaryLabel),
            ),
          ),
        ],
      ],
    );
  }
}

enum _CreditsNoticeTone { neutral, error }

class _CreditsStatusHero extends StatelessWidget {
  const _CreditsStatusHero({
    required this.eyebrow,
    required this.title,
    required this.description,
  });

  final String eyebrow;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.fromLTRB(21, 25, 21, 25),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: dark
              ? const [Color(0xFF49375C), Color(0xFF513D46)]
              : const [Color(0xFFE5D6E9), Color(0xFFEFDDD1)],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            eyebrow,
            style: context.mobileTypography.metadata.copyWith(
              color: tokens.ink,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
          ),
          const SizedBox(height: Grid.xs),
          Text(
            title,
            style: context.mobileTypography.companyHubTitle.copyWith(
              color: tokens.ink,
              fontSize: 24,
              height: 1.1,
              letterSpacing: -0.7,
            ),
          ),
          const SizedBox(height: Grid.xs),
          Text(
            description,
            style: context.mobileTypography.conversation.copyWith(
              color: tokens.ink,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _CreditsStatusNotice extends StatelessWidget {
  const _CreditsStatusNotice({
    required this.title,
    required this.description,
    required this.tone,
  });

  final String title;
  final String description;
  final _CreditsNoticeTone tone;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.all(Grid.xs),
      decoration: BoxDecoration(
        color: tokens.paper,
        border: Border.all(color: tokens.line),
        borderRadius: BorderRadius.circular(Radii.dialog),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 3,
            height: 54,
            decoration: BoxDecoration(
              color: tone == _CreditsNoticeTone.error
                  ? const Color(0xFFC56E77)
                  : const Color(0xFF9E7DB5),
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(width: Grid.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: context.mobileTypography.conversation.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  description,
                  style: context.mobileTypography.metadata.copyWith(
                    color: tokens.muted,
                    height: 1.5,
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

class _CreditsSummaryRow extends StatelessWidget {
  const _CreditsSummaryRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      constraints: const BoxConstraints(minHeight: 46),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      padding: const EdgeInsets.symmetric(vertical: Grid.xxs),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: context.mobileTypography.metadata.copyWith(
                color: tokens.muted,
              ),
            ),
          ),
          const SizedBox(width: Grid.xs),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: context.mobileTypography.metadata.copyWith(
                color: tokens.ink,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CreditsPaymentUnavailable extends StatelessWidget {
  const _CreditsPaymentUnavailable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
    children: [
      _CreditsStatusNotice(
        title: 'Payment status unavailable',
        description:
            'Your payment may still be processing. We have not marked it failed or asked you to pay again.',
        tone: _CreditsNoticeTone.error,
      ),
      const SizedBox(height: Grid.xs),
      SizedBox(
        width: double.infinity,
        height: 44,
        child: FilledButton(
          key: const ValueKey('credits-payment-retry-status'),
          style: mobileFlowActionButtonStyle(context),
          onPressed: onRetry,
          child: const Text('Retry status check'),
        ),
      ),
      const SizedBox(height: Grid.xxs),
      SizedBox(
        width: double.infinity,
        height: 44,
        child: TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Back to credits'),
        ),
      ),
    ],
  );
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
    this.onPressed,
  });

  final String title;
  final String subtitle;
  final String amount;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final row = Container(
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
    final onTap = onPressed;
    if (onTap == null) return row;
    return Semantics(
      button: true,
      label: '$title, $subtitle, $amount',
      onTap: onTap,
      child: ExcludeSemantics(
        child: InkWell(onTap: onTap, child: row),
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
    if (failure case CreditsFailure(kind: CreditsFailureKind.unavailable)) {
      return SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(30, 56, 30, 24),
          child: Column(
            children: [
              Container(
                width: 66,
                height: 66,
                decoration: BoxDecoration(
                  color: tokens.soft,
                  borderRadius: BorderRadius.circular(20),
                ),
                alignment: Alignment.center,
                child: Icon(
                  LucideIcons.briefcaseBusiness,
                  size: 22,
                  color: tokens.action,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'Credits could not load',
                textAlign: TextAlign.center,
                style: context.mobileTypography.companyHubTitle.copyWith(
                  color: tokens.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 22),
              Text(
                'The connected source is unavailable. Existing work is kept, and missing data is not shown as zero.',
                textAlign: TextAlign.center,
                style: context.mobileTypography.conversation.copyWith(
                  color: tokens.muted,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 33),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  key: const ValueKey('credits-retry'),
                  onPressed: onRetry,
                  style: mobileFlowActionButtonStyle(context),
                  child: const Text('Retry connection'),
                ),
              ),
            ],
          ),
        ),
      );
    }

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

String _paymentIntentLabel(
  CreditsPaymentIntent intent,
  CreditsOverview overview,
) {
  final confirmed =
      intent.status == 'paid' &&
      overview.ledger.any(
        (entry) =>
            entry.reference == intent.reference &&
            entry.type == 'purchase' &&
            entry.amountNanoUsd == intent.grantNanoUsd,
      );
  if (confirmed) return 'Payment confirmed';
  if (intent.status == 'pending' ||
      intent.status == 'delayed' ||
      intent.status == 'uncertain' ||
      intent.status == 'paid') {
    return 'Payment pending';
  }
  if (intent.status == 'failed') return 'Payment failed';
  if (intent.status == 'cancelled') return 'Payment cancelled';
  return 'Payment status unavailable';
}
