part of 'credits_pages.dart';

class CreditsTopUpPage extends HookConsumerWidget {
  const CreditsTopUpPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final catalog = ref.watch(creditsPackCatalogProvider);
    final selectedPackId = useState<String?>(null);
    final packList = catalog.asData?.value.packs ?? const <CreditsPack>[];
    final selectedPack = packList
        .where((pack) => pack.id == selectedPackId.value)
        .firstOrNull;

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Colony credits'),
      body: catalog.when(
        loading: () => const Center(
          child: CircularProgressIndicator(
            semanticsLabel: 'Loading payment options',
          ),
        ),
        error: (error, _) => _CreditsUnavailable(
          failure: error,
          onRetry: () => ref.invalidate(creditsPackCatalogProvider),
        ),
        data: (data) => !data.enabled || data.packs.isEmpty
            ? _CreditsUnavailable(
                failure: const CreditsFailure(CreditsFailureKind.unavailable),
                onRetry: () => ref.invalidate(creditsPackCatalogProvider),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
                children: [
                  _CreditsStatusHero(
                    eyebrow: 'COLONY CREDITS',
                    title: 'Room for the next idea.',
                    description: 'Choose an amount for your business balance.',
                  ),
                  const SizedBox(height: Grid.md),
                  Text(
                    'Add to business balance',
                    style: context.mobileTypography.companySection.copyWith(
                      color: context.mobileTokens.ink,
                    ),
                  ),
                  const SizedBox(height: Grid.xxs),
                  for (final pack in data.packs)
                    _CreditsPackChoice(
                      pack: pack,
                      selected: selectedPackId.value == pack.id,
                      onSelected: () => selectedPackId.value = pack.id,
                    ),
                ],
              ),
      ),
      bottomNavigationBar:
          catalog.asData?.value.enabled == true &&
              catalog.asData!.value.packs.isNotEmpty
          ? SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                child: SizedBox(
                  height: 48,
                  child: FilledButton(
                    key: const ValueKey('credits-review-payment'),
                    style: mobileFlowActionButtonStyle(context),
                    onPressed: selectedPack == null
                        ? null
                        : () => Navigator.of(context).push<void>(
                            MaterialPageRoute<void>(
                              builder: (_) =>
                                  CreditsQuotePage(pack: selectedPack),
                            ),
                          ),
                    child: const Text('Review payment'),
                  ),
                ),
              ),
            )
          : null,
    );
  }
}

class _CreditsPackChoice extends StatelessWidget {
  const _CreditsPackChoice({
    required this.pack,
    required this.selected,
    required this.onSelected,
  });

  final CreditsPack pack;
  final bool selected;
  final VoidCallback onSelected;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    final border = selected ? tokens.action : tokens.line;
    final label =
        '${pack.name}, ${_money(pack.grantUsdCents, 'USD')} credits, '
        '${_money(pack.chargeZarCents, 'ZAR')} payment charge';
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      onTap: onSelected,
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsets.only(top: Grid.xs),
          child: Material(
            color: tokens.paper,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              key: ValueKey('credits-pack-${pack.id}'),
              onTap: onSelected,
              borderRadius: BorderRadius.circular(16),
              child: Container(
                constraints: const BoxConstraints(minHeight: 76),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 13,
                ),
                decoration: BoxDecoration(
                  border: Border.all(color: border, width: selected ? 1.5 : 1),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            pack.name,
                            style: context.mobileTypography.conversation
                                .copyWith(
                                  color: tokens.ink,
                                  fontWeight: FontWeight.w700,
                                ),
                          ),
                          Text(
                            '${_money(pack.grantUsdCents, 'USD')} credits',
                            style: context.mobileTypography.metadata.copyWith(
                              color: tokens.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: Grid.xs),
                    Text(
                      _money(pack.chargeZarCents, 'ZAR'),
                      textAlign: TextAlign.end,
                      style: context.mobileTypography.conversation.copyWith(
                        color: tokens.ink,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class CreditsQuotePage extends HookConsumerWidget {
  const CreditsQuotePage({required this.pack, super.key});

  final CreditsPack pack;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final idempotencyKey = useState<String?>(null);
    final submitting = useState(false);
    final failure = useState<Object?>(null);

    Future<void> continueToPayfast() async {
      if (submitting.value) return;
      submitting.value = true;
      failure.value = null;
      final key = idempotencyKey.value ?? const Uuid().v4();
      idempotencyKey.value = key;
      try {
        final checkout = await _createOrResumeCheckout(
          context,
          ref,
          pack.id,
          key,
        );
        if (checkout != null && context.mounted) {
          await Navigator.of(context).push<void>(
            MaterialPageRoute<void>(
              builder: (_) => CreditsPaymentHandoffPage(checkout: checkout),
            ),
          );
        }
      } catch (error) {
        failure.value = error;
      } finally {
        submitting.value = false;
      }
    }

    if (failure.value != null) {
      return Scaffold(
        backgroundColor: context.mobileTokens.canvas,
        appBar: const MobileFlowAppBar(title: 'Colony credits'),
        body: _CreditsUnavailable(
          failure: failure.value!,
          onRetry: () {
            failure.value = null;
            unawaited(continueToPayfast());
          },
        ),
      );
    }

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Colony credits'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
        children: [
          _CreditsStatusHero(
            eyebrow: 'COLONY CREDITS',
            title: 'A little more\nroom to work.',
            description: 'Review your quoted payment before leaving Colony.',
          ),
          const SizedBox(height: Grid.sm),
          _CreditsSummaryRow(
            label: 'Credits to receive',
            value: _money(pack.grantUsdCents, 'USD'),
          ),
          _CreditsSummaryRow(
            label: 'Payment charge',
            value: _money(pack.chargeZarCents, 'ZAR'),
          ),
          const _CreditsSummaryRow(label: 'Payment provider', value: 'Payfast'),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
          child: SizedBox(
            height: 48,
            child: FilledButton(
              key: const ValueKey('credits-continue-to-payfast'),
              style: mobileFlowActionButtonStyle(context),
              onPressed: submitting.value ? null : continueToPayfast,
              child: submitting.value
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Continue to Payfast'),
            ),
          ),
        ),
      ),
    );
  }
}

class CreditsPaymentHandoffPage extends StatelessWidget {
  const CreditsPaymentHandoffPage({required this.checkout, super.key});

  final CreditsCheckout checkout;

  @override
  Widget build(BuildContext context) {
    final quote = _CreditsCheckoutQuote(checkout: checkout);
    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Colony credits'),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
        children: [
          _CreditsStatusHero(
            eyebrow: 'SECURE PAYMENT',
            title: 'Continue in\nyour browser.',
            description:
                'Payfast handles the payment. Colony never asks for card details here.',
          ),
          const SizedBox(height: Grid.sm),
          quote,
          const SizedBox(height: Grid.xs),
          _CreditsStatusNotice(
            title: 'Payment handoff',
            description:
                'Return to Colony after the browser finishes. Closing the browser does not confirm or cancel a payment.',
            tone: _CreditsNoticeTone.neutral,
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton(
                  key: const ValueKey('credits-open-payment-browser'),
                  style: mobileFlowActionButtonStyle(context),
                  onPressed:
                      checkout.canOpenPayment &&
                          _isAllowedPayfastAction(checkout)
                      ? () => Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (_) =>
                                CreditsPaymentBrowserPage(checkout: checkout),
                          ),
                        )
                      : () => Navigator.of(context).push<void>(
                          MaterialPageRoute<void>(
                            builder: (_) => CreditsPaymentStatusPage(
                              reference: checkout.reference,
                            ),
                          ),
                        ),
                  child: const Text('Open payment browser'),
                ),
              ),
              const SizedBox(height: Grid.xxs),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: TextButton(
                  onPressed: () => _returnToCredits(context),
                  child: const Text('Back to credits'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CreditsCheckoutQuote extends StatelessWidget {
  const _CreditsCheckoutQuote({required this.checkout});

  final CreditsCheckout checkout;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      _CreditsSummaryRow(
        label: 'Credits to receive',
        value: _money(checkout.grantUsdCents, 'USD'),
      ),
      _CreditsSummaryRow(
        label: 'Payment charge',
        value: _money(checkout.amountZarCents, 'ZAR'),
      ),
      const _CreditsSummaryRow(label: 'Payment provider', value: 'Payfast'),
    ],
  );
}

class CreditsPaymentBrowserPage extends HookConsumerWidget {
  const CreditsPaymentBrowserPage({required this.checkout, super.key});

  final CreditsCheckout checkout;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final returned = useState(false);
    final canOpen =
        checkout.canOpenPayment && _isAllowedPayfastAction(checkout);
    final controller = useMemoized<WebViewController?>(() {
      if (!canOpen) return null;
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(
          NavigationDelegate(
            onNavigationRequest: (request) {
              final uri = Uri.tryParse(request.url);
              if (uri != null &&
                  _isExpectedPaymentReturn(uri, checkout.reference)) {
                if (!returned.value && context.mounted) {
                  returned.value = true;
                  Navigator.of(context).pushReplacement<void, void>(
                    MaterialPageRoute<void>(
                      builder: (_) => CreditsPaymentStatusPage(
                        reference: checkout.reference,
                        isBrowserReturn: true,
                      ),
                    ),
                  );
                }
                return NavigationDecision.prevent;
              }
              if (uri == null ||
                  uri.scheme != 'https' ||
                  uri.host.isEmpty ||
                  uri.userInfo.isNotEmpty) {
                return NavigationDecision.prevent;
              }
              return NavigationDecision.navigate;
            },
            onWebResourceError: (error) {
              if (error.isForMainFrame == false ||
                  returned.value ||
                  !context.mounted) {
                return;
              }
              returned.value = true;
              Navigator.of(context).pushReplacement<void, void>(
                MaterialPageRoute<void>(
                  builder: (_) =>
                      CreditsPaymentStatusPage(reference: checkout.reference),
                ),
              );
            },
          ),
        );
      unawaited(
        controller
            .loadRequest(
              Uri.parse(checkout.authorizationUrl!),
              method: LoadRequestMethod.post,
              body: Uint8List.fromList(_formBody(checkout.authorizationFields)),
            )
            .catchError((Object _) {
              if (returned.value || !context.mounted) return;
              returned.value = true;
              Navigator.of(context).pushReplacement<void, void>(
                MaterialPageRoute<void>(
                  builder: (_) =>
                      CreditsPaymentStatusPage(reference: checkout.reference),
                ),
              );
            }),
      );
      return controller;
    }, [checkout.reference]);

    if (!canOpen || controller == null) {
      return CreditsPaymentStatusPage(reference: checkout.reference);
    }

    return Scaffold(
      backgroundColor: context.mobileTokens.canvas,
      appBar: const MobileFlowAppBar(title: 'Payfast handoff'),
      body: WebViewWidget(controller: controller),
    );
  }
}

bool _isAllowedPayfastAction(CreditsCheckout checkout) {
  final rawUrl = checkout.authorizationUrl;
  if (rawUrl == null || checkout.authorizationMethod != 'POST') return false;
  final uri = Uri.tryParse(rawUrl);
  final expectedHost = checkout.sandbox
      ? 'sandbox.payfast.co.za'
      : 'www.payfast.co.za';
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host != expectedHost ||
      uri.hasPort ||
      uri.userInfo.isNotEmpty ||
      uri.path != '/eng/process' ||
      uri.hasQuery ||
      uri.hasFragment) {
    return false;
  }
  if (checkout.authorizationFields.isEmpty ||
      checkout.authorizationFields.length > 64 ||
      checkout.authorizationFields.any(
        (field) =>
            field.name.isEmpty ||
            field.name.length > 100 ||
            field.value.length > 4096 ||
            field.name.contains('&') ||
            field.name.contains('='),
      ) ||
      checkout.authorizationFields
              .where((field) => field.name == 'signature')
              .length !=
          1) {
    return false;
  }
  return _formBody(checkout.authorizationFields).length <= 32768;
}

List<int> _formBody(List<CreditsFormField> fields) => utf8.encode(
  fields
      .map(
        (field) =>
            '${Uri.encodeQueryComponent(field.name)}='
            '${Uri.encodeQueryComponent(field.value)}',
      )
      .join('&'),
);

bool _isExpectedPaymentReturn(Uri uri, String reference) {
  final params = uri.queryParametersAll;
  return uri.scheme == 'buzz' &&
      uri.host == 'credits' &&
      uri.path == '/payment' &&
      !uri.hasPort &&
      uri.userInfo.isEmpty &&
      !uri.hasFragment &&
      params.keys.length == 1 &&
      params['reference']?.length == 1 &&
      params['reference']?.single == reference;
}

Future<CreditsCheckout?> _createOrResumeCheckout(
  BuildContext context,
  WidgetRef ref,
  String packId,
  String idempotencyKey,
) async {
  final api = ref.read(creditsApiProvider);
  try {
    return await api.createCheckout(
      packId: packId,
      idempotencyKey: idempotencyKey,
    );
  } on CreditsFailure catch (failure) {
    final reference = failure.reference;
    if ((failure.kind != CreditsFailureKind.openIntent &&
            failure.kind != CreditsFailureKind.checkoutClosed) ||
        reference == null) {
      rethrow;
    }
    CreditsPaymentIntent intent;
    try {
      intent = await api.readPaymentIntent(reference);
    } on CreditsFailure {
      if (context.mounted) _openPaymentStatus(context, reference);
      return null;
    }
    if (intent.status != 'pending') {
      if (context.mounted) _openPaymentStatus(context, reference);
      return null;
    }
    try {
      return await api.createCheckout(
        packId: intent.packId,
        idempotencyKey: intent.idempotencyKey,
      );
    } on CreditsFailure {
      if (context.mounted) _openPaymentStatus(context, reference);
      return null;
    }
  }
}

void _openPaymentStatus(BuildContext context, String reference) {
  Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (_) => CreditsPaymentStatusPage(reference: reference),
    ),
  );
}

Future<void> _retryFailedPayment(
  BuildContext context,
  WidgetRef ref,
  CreditsPaymentIntent payment,
) async {
  try {
    final checkout = await _createOrResumeCheckout(
      context,
      ref,
      payment.packId,
      const Uuid().v4(),
    );
    if (checkout != null && context.mounted) {
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => CreditsPaymentHandoffPage(checkout: checkout),
        ),
      );
    }
  } on CreditsFailure {
    if (context.mounted) {
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => CreditsQuotePage(
            pack: CreditsPack(
              id: payment.packId,
              name: payment.packId,
              chargeZarCents: payment.amountZarCents,
              grantNanoUsd: payment.grantNanoUsd,
              grantUsdCents: payment.grantUsdCents,
            ),
          ),
        ),
      );
    }
  }
}

void _returnToCredits(BuildContext context) {
  final navigator = Navigator.of(context);
  var foundBalance = false;
  navigator.popUntil((route) {
    if (route.settings.name == MobileRoutes.creditsBalance.path) {
      foundBalance = true;
      return true;
    }
    return route.isFirst;
  });
  if (!foundBalance && context.mounted) {
    navigator.push<void>(
      MaterialPageRoute<void>(
        settings: RouteSettings(name: MobileRoutes.creditsBalance.path),
        builder: (_) => const CreditsBalancePage(),
      ),
    );
  }
}
