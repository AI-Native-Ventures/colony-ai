part of 'relay_session.dart';

class _LiveListener {
  final void Function(NostrEvent) onEvent;
  final void Function(String message)? onClosed;
  final void Function(RelaySubscriptionStatus status)? onStatusChanged;
  bool active = true;

  _LiveListener({required this.onEvent, this.onClosed, this.onStatusChanged});
}

class _LiveSubscription {
  final NostrFilter filter;
  final List<_LiveListener> listeners = [];
  Completer<void>? readyCompleter;
  int? lastSeenCreatedAt;
  int closedRetryAttempt = 0;
  Timer? closedRetryTimer;
  bool ready = false;

  _LiveSubscription({
    required this.filter,
    required _LiveListener listener,
    this.readyCompleter,
  }) {
    listeners.add(listener);
  }
}

class _ClosedRetry {
  final _LiveSubscription subscription;
  final int generation;
  _ClosedRetry({required this.subscription, required this.generation});
}

class _PendingEvent {
  final Completer<NostrEvent> completer;
  Timer? timeout;

  _PendingEvent({required this.completer});
}

class _BufferedEvent {
  final String subId;
  final NostrEvent event;

  _BufferedEvent(this.subId, this.event);
}
