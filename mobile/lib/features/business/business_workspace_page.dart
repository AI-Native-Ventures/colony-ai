import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_hooks/flutter_hooks.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:intl/intl.dart';

import '../../shared/business/mobile_business_records.dart';
import '../../shared/theme/theme.dart';
import '../goals/goal_widgets.dart';
import 'money_workspace_page.dart';

part 'business_workspace_page/adjustment.dart';
part 'business_workspace_page/content.dart';
part 'business_workspace_page/widgets.dart';

/// Batch 2 business browsing, backed by signed workspace records.
class BusinessWorkspacePage extends HookConsumerWidget {
  const BusinessWorkspacePage({
    required this.channelDirectory,
    required this.communityId,
    required this.onRetryChannelDirectory,
    this.communityName,
    this.onOpenChat,
    super.key,
  });

  final AsyncValue<List<MobileBusinessChannelCandidate>> channelDirectory;
  final String? communityId;
  final VoidCallback onRetryChannelDirectory;
  final String? communityName;
  final VoidCallback? onOpenChat;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final routes = useState<List<_BusinessRoute>>([_BusinessRoute.home()]);
    final refreshVersion = useState(0);
    final adjustmentDenied = useState(false);
    final repository = ref.watch(mobileBusinessRepositoryProvider);
    final channels = channelDirectory.asData?.value ?? const [];
    final channelKey = channels.map((channel) => channel.id).join(',');
    final recordsFuture = useMemoized(
      () => _loadBusinessRecords(repository, channels, communityId),
      [repository, channelKey, communityId, refreshVersion.value],
    );
    final recordsSnapshot = useFuture(recordsFuture);

    void push(_BusinessRoute route) {
      routes.value = [...routes.value, route];
    }

    void pop() {
      adjustmentDenied.value = false;
      if (routes.value.length == 1) {
        unawaited(Navigator.of(context).maybePop());
      } else {
        routes.value = routes.value.sublist(0, routes.value.length - 1);
      }
    }

    final route = routes.value.last;
    if (route.kind == _BusinessRouteKind.money) {
      return MoneyWorkspacePage(
        channelDirectory: channelDirectory,
        onRetryChannelDirectory: onRetryChannelDirectory,
        title: route.title ?? 'Invoices',
        onBack: () {
          refreshVersion.value++;
          pop();
        },
        showDueDates: false,
        onOpenIssuedInvoice: (invoice) {
          refreshVersion.value++;
          final invoiceId = invoice.stringValue('invoiceId');
          if (invoiceId != null) {
            push(_BusinessRoute.invoiceDetail(invoiceId));
          }
        },
      );
    }

    final headerTitle = switch (route.kind) {
      _BusinessRouteKind.home ||
      _BusinessRouteKind.proposals ||
      _BusinessRouteKind.proposal ||
      _BusinessRouteKind.services ||
      _BusinessRouteKind.service => 'Business',
      _BusinessRouteKind.social => 'Social',
      _BusinessRouteKind.website => 'Website',
      _BusinessRouteKind.invoiceEmpty => 'Invoices',
      _BusinessRouteKind.invoiceDetail => 'New invoice',
      _BusinessRouteKind.adjustment => 'Revenue adjustment',
      _BusinessRouteKind.money => 'Invoices',
    };
    final displayedHeaderTitle =
        adjustmentDenied.value && route.kind == _BusinessRouteKind.adjustment
        ? 'Business'
        : headerTitle;

    return ColoredBox(
      color: context.mobileTokens.canvas,
      child: Column(
        children: [
          GoalPageHeader(
            title: displayedHeaderTitle,
            subtitle: communityName,
            onBack: pop,
            backLabel: route.kind == _BusinessRouteKind.home
                ? 'Back to company'
                : 'Back to $displayedHeaderTitle',
          ),
          Expanded(
            child: channelDirectory.hasError
                ? _BusinessUnavailable(onRetry: onRetryChannelDirectory)
                : channelDirectory.isLoading
                ? const _BusinessLoading()
                : recordsSnapshot.hasError
                ? _BusinessUnavailable(onRetry: () => refreshVersion.value++)
                : recordsSnapshot.connectionState != ConnectionState.done
                ? const _BusinessLoading()
                : _buildBusinessRoute(
                    route: route,
                    records: recordsSnapshot.data!,
                    onPush: push,
                    onPop: pop,
                    onRefresh: () => refreshVersion.value++,
                    onAdjustmentDenied: (denied) =>
                        adjustmentDenied.value = denied,
                    communityName: communityName,
                    onOpenChat: onOpenChat,
                    channelDirectory: channelDirectory,
                    onRetryChannelDirectory: onRetryChannelDirectory,
                  ),
          ),
        ],
      ),
    );
  }
}

enum _BusinessRouteKind {
  home,
  proposals,
  proposal,
  services,
  service,
  social,
  website,
  invoiceEmpty,
  invoiceDetail,
  adjustment,
  money,
}

class _BusinessRoute {
  const _BusinessRoute._(this.kind, {this.recordId, this.title});

  const _BusinessRoute.home() : this._(_BusinessRouteKind.home);
  const _BusinessRoute.proposals() : this._(_BusinessRouteKind.proposals);
  const _BusinessRoute.proposal(String eventId)
    : this._(_BusinessRouteKind.proposal, recordId: eventId);
  const _BusinessRoute.services() : this._(_BusinessRouteKind.services);
  const _BusinessRoute.service(String eventId)
    : this._(_BusinessRouteKind.service, recordId: eventId);
  const _BusinessRoute.social() : this._(_BusinessRouteKind.social);
  const _BusinessRoute.website() : this._(_BusinessRouteKind.website);
  const _BusinessRoute.invoiceEmpty() : this._(_BusinessRouteKind.invoiceEmpty);
  const _BusinessRoute.invoiceDetail(String eventId)
    : this._(_BusinessRouteKind.invoiceDetail, recordId: eventId);
  const _BusinessRoute.adjustment(String invoiceId)
    : this._(_BusinessRouteKind.adjustment, recordId: invoiceId);
  const _BusinessRoute.money({required String title})
    : this._(_BusinessRouteKind.money, title: title);

  final _BusinessRouteKind kind;
  final String? recordId;
  final String? title;
}

Future<_BusinessRecords> _loadBusinessRecords(
  MobileBusinessRepository repository,
  List<MobileBusinessChannelCandidate> channels,
  String? communityId,
) async {
  if (communityId == null) {
    throw StateError('The active company is unavailable.');
  }
  final result = await Future.wait<Object>([
    repository.loadDiscovery(channels, communityId: communityId),
    repository.loadMoney(channels),
  ]);
  return _BusinessRecords(
    discovery: result[0] as MobileDiscoveryRecords,
    money: result[1] as MobileMoneyRecords,
  );
}

class _BusinessRecords {
  const _BusinessRecords({required this.discovery, required this.money});

  final MobileDiscoveryRecords discovery;
  final MobileMoneyRecords money;
}

Widget _buildBusinessRoute({
  required _BusinessRoute route,
  required _BusinessRecords records,
  required ValueChanged<_BusinessRoute> onPush,
  required VoidCallback onPop,
  required VoidCallback onRefresh,
  required ValueChanged<bool> onAdjustmentDenied,
  required String? communityName,
  required VoidCallback? onOpenChat,
  required AsyncValue<List<MobileBusinessChannelCandidate>> channelDirectory,
  required VoidCallback onRetryChannelDirectory,
}) {
  return switch (route.kind) {
    _BusinessRouteKind.home => _BusinessHome(
      communityName: communityName,
      onProposals: () => onPush(const _BusinessRoute.proposals()),
      onServices: () => onPush(const _BusinessRoute.services()),
      onInvoices: () => onPush(
        records.money.invoiceHeads.isEmpty
            ? const _BusinessRoute.invoiceEmpty()
            : const _BusinessRoute.money(title: 'Invoices'),
      ),
      onFollowUps: null,
      onSocial: () => onPush(const _BusinessRoute.social()),
      onWebsite: () => onPush(const _BusinessRoute.website()),
    ),
    _BusinessRouteKind.proposals => _BusinessProposalList(
      records: records.discovery,
      onOpenProposal: (record) =>
          onPush(_BusinessRoute.proposal(record.event.id)),
    ),
    _BusinessRouteKind.proposal => _BusinessProposalDetail(
      records: records,
      eventId: route.recordId!,
      onDraftFollowUp: null,
      onReviewAdjustment: (invoice) =>
          onPush(_BusinessRoute.adjustment(invoice.stringValue('invoiceId')!)),
    ),
    _BusinessRouteKind.services => _BusinessServiceList(
      records: records.discovery,
      onOpenService: (record) =>
          onPush(_BusinessRoute.service(record.event.id)),
    ),
    _BusinessRouteKind.service => _BusinessServiceDetail(
      records: records.discovery,
      eventId: route.recordId!,
      onOpenProposal: (record) =>
          onPush(_BusinessRoute.proposal(record.event.id)),
    ),
    _BusinessRouteKind.social => _BusinessComingLater(
      eyebrow: 'COMING LATER',
      headline: 'Your social presence,\nin one place.',
      subhead: 'Publishing is not available yet.',
      progressTitle: 'Keep making progress',
      progressBody:
          'Plan content with your team, develop designs and collect feedback in a channel.',
      assuranceTitle: 'Nothing will publish',
      assuranceBody:
          'Account connections, scheduling and publishing controls will appear when the live service is available.',
      onOpenChat: onOpenChat,
      rose: true,
    ),
    _BusinessRouteKind.website => _BusinessComingLater(
      eyebrow: 'COMING LATER',
      headline: 'A home for\nyour business.',
      subhead: 'Publishing is not available yet.',
      progressTitle: 'Keep making progress',
      progressBody:
          'Work on your site copy, structure and assets with your team in a channel.',
      assuranceTitle: 'Nothing will publish',
      assuranceBody:
          'Account connections, scheduling and publishing controls will appear when the live service is available.',
      onOpenChat: onOpenChat,
    ),
    _BusinessRouteKind.invoiceEmpty => const _BusinessInvoiceEmpty(),
    _BusinessRouteKind.invoiceDetail => _buildInvoiceDetailRoute(
      route: route,
      records: records,
      workspaceName: communityName,
      onBack: onPop,
    ),
    _BusinessRouteKind.adjustment => _buildAdjustmentRoute(
      route: route,
      records: records,
      onDenialChanged: onAdjustmentDenied,
      onSaved: () {
        onRefresh();
        onPop();
      },
    ),
    _BusinessRouteKind.money => MoneyWorkspacePage(
      channelDirectory: channelDirectory,
      onRetryChannelDirectory: onRetryChannelDirectory,
      title: route.title ?? 'Invoices',
      onBack: onPop,
      showDueDates: false,
      onOpenIssuedInvoice: (invoice) {
        onRefresh();
        final invoiceId = invoice.stringValue('invoiceId');
        if (invoiceId != null) {
          onPush(_BusinessRoute.invoiceDetail(invoiceId));
        }
      },
    ),
  };
}

Widget _buildInvoiceDetailRoute({
  required _BusinessRoute route,
  required _BusinessRecords records,
  required String? workspaceName,
  required VoidCallback onBack,
}) {
  final invoice = records.money.invoiceHeads
      .where((record) => record.stringValue('invoiceId') == route.recordId)
      .firstOrNull;
  if (invoice == null || invoice.stringValue('status') != 'issued') {
    return const _BusinessUnavailable();
  }
  final currency = invoice.stringValue('currency')?.trim();
  final total = invoice.integerValue('totalMinor');
  final lines = _businessInvoiceLines(invoice);
  final taxLines = _businessInvoiceTaxLines(invoice);
  if (currency == null ||
      currency.isEmpty ||
      total == null ||
      lines.isEmpty ||
      taxLines == null ||
      workspaceName?.trim().isNotEmpty != true) {
    return const _BusinessUnavailable();
  }
  for (final line in lines) {
    if (line['description'] is! String ||
        line['quantityHundredths'] is! int ||
        line['unitAmountMinor'] is! int) {
      return const _BusinessUnavailable();
    }
  }
  return _BusinessIssuedInvoiceDetail(
    invoice: invoice,
    clientName: _businessClientName(invoice.stringValue('clientId'), records),
    workspaceName: workspaceName,
    lines: lines,
    taxLines: taxLines,
    onBack: onBack,
  );
}

Widget _buildAdjustmentRoute({
  required _BusinessRoute route,
  required _BusinessRecords records,
  required ValueChanged<bool> onDenialChanged,
  required VoidCallback onSaved,
}) {
  final invoiceId = route.recordId;
  final invoice = invoiceId == null
      ? null
      : records.money.invoiceHeads
            .where((record) => record.stringValue('invoiceId') == invoiceId)
            .firstOrNull;
  if (invoice == null || invoice.stringValue('status') != 'issued') {
    return const _BusinessUnavailable();
  }
  return BusinessAdjustmentFlow(
    invoice: invoice,
    clientName: _businessClientName(invoice.stringValue('clientId'), records),
    onDenialChanged: onDenialChanged,
    onSaved: onSaved,
  );
}

String _businessClientName(String? clientId, _BusinessRecords records) {
  if (clientId == null) return 'Client';
  final client = records.money.clientHeads
      .where((record) => record.channelId == clientId)
      .firstOrNull;
  final name = client?.stringValue('displayName');
  return name != null && name.trim().isNotEmpty ? name.trim() : 'Client';
}
