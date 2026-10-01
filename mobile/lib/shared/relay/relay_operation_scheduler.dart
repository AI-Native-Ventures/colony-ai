import 'dart:async';

enum RelayOperationPriority { background, normal, visible, interactive }

class _QueuedRelayOperation {
  final int sequence;
  final RelayOperationPriority priority;
  final bool Function() isCurrent;
  final int Function() minimumDelayMs;
  final void Function() send;
  final Completer<void> completer;

  _QueuedRelayOperation({
    required this.sequence,
    required this.priority,
    required this.isCurrent,
    required this.minimumDelayMs,
    required this.send,
    required this.completer,
  });
}

/// Paces authenticated REQ, COUNT, and EVENT frames below the relay's
/// 50-operation fixed window. State belongs to one authenticated relay session.
class RelayOperationScheduler {
  static const burstCapacity = 8;
  static const operationInterval = Duration(milliseconds: 125);
  static const maxQueuedOperations = 256;

  final DateTime Function() _now;
  final List<_QueuedRelayOperation> _queue = [];
  double _tokens = burstCapacity.toDouble();
  DateTime _lastRefillAt;
  int _nextSequence = 0;
  Timer? _refillTimer;

  RelayOperationScheduler({DateTime Function()? now})
    : _now = now ?? DateTime.now,
      _lastRefillAt = (now ?? DateTime.now)();

  Future<void> send({
    required List<dynamic> frame,
    required bool Function() isCurrent,
    required int Function() minimumDelayMs,
    required void Function() send,
    RelayOperationPriority priority = RelayOperationPriority.normal,
  }) {
    if (!_isAdmissionFrame(frame)) {
      if (!isCurrent()) {
        return Future.error(StateError('Relay operation was superseded.'));
      }
      send();
      return Future.value();
    }
    if (_queue.length >= maxQueuedOperations) {
      return Future.error(
        StateError('Relay outbound operation queue is full.'),
      );
    }

    final completer = Completer<void>();
    _queue.add(
      _QueuedRelayOperation(
        sequence: _nextSequence++,
        priority: priority,
        isCurrent: isCurrent,
        minimumDelayMs: minimumDelayMs,
        send: send,
        completer: completer,
      ),
    );
    _drain();
    return completer.future;
  }

  void reset() {
    _refillTimer?.cancel();
    _refillTimer = null;
    for (final operation in _queue) {
      if (!operation.completer.isCompleted) {
        operation.completer.completeError(
          StateError('Relay operation was superseded.'),
        );
      }
    }
    _queue.clear();
    _tokens = burstCapacity.toDouble();
    _lastRefillAt = _now();
    _nextSequence = 0;
  }

  void _drain() {
    _refill();
    _queue.sort((left, right) {
      final priorityOrder = right.priority.index.compareTo(left.priority.index);
      return priorityOrder != 0
          ? priorityOrder
          : left.sequence.compareTo(right.sequence);
    });

    while (_queue.isNotEmpty) {
      final operation = _queue.first;
      if (!operation.isCurrent()) {
        _queue.removeAt(0);
        if (!operation.completer.isCompleted) {
          operation.completer.completeError(
            StateError('Relay operation was superseded.'),
          );
        }
        continue;
      }

      final throttleDelay = operation.minimumDelayMs();
      final tokenDelay = _tokens >= 1
          ? 0
          : ((1 - _tokens) * operationInterval.inMilliseconds).ceil();
      final delayMs = throttleDelay > tokenDelay ? throttleDelay : tokenDelay;
      if (delayMs > 0) {
        _scheduleDrain(delayMs);
        return;
      }

      _queue.removeAt(0);
      _tokens -= 1;
      try {
        operation.send();
        if (!operation.completer.isCompleted) operation.completer.complete();
      } catch (error, stackTrace) {
        if (!operation.completer.isCompleted) {
          operation.completer.completeError(error, stackTrace);
        }
      }
      _refill();
    }
  }

  void _scheduleDrain(int delayMs) {
    if (_refillTimer != null) return;
    _refillTimer = Timer(Duration(milliseconds: delayMs), () {
      _refillTimer = null;
      _drain();
    });
  }

  void _refill() {
    final now = _now();
    final elapsedMs = now.difference(_lastRefillAt).inMicroseconds / 1000;
    _tokens = (_tokens + elapsedMs / operationInterval.inMilliseconds)
        .clamp(0, burstCapacity)
        .toDouble();
    _lastRefillAt = now;
  }

  bool _isAdmissionFrame(List<dynamic> frame) =>
      frame.isNotEmpty && const {'REQ', 'COUNT', 'EVENT'}.contains(frame.first);
}
