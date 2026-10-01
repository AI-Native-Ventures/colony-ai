import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/shared/relay/relay_operation_scheduler.dart';

void main() {
  test('HTTP query scheduler stays under 300 calls per minute', () async {
    var now = DateTime(2026);
    final timers = <_ManualTimer>[];
    final scheduler = RelayOperationScheduler(
      now: () => now,
      timerFactory: (duration, callback) {
        final timer = _ManualTimer(duration, callback);
        timers.add(timer);
        return timer;
      },
    );
    final sentAt = <DateTime>[];
    final requests = [
      for (var index = 0; index < 110; index++)
        scheduler
            .acquireHttpQuery(isCurrent: () => true, minimumDelayMs: () => 0)
            .then((_) => sentAt.add(now)),
    ];

    await _flushMicrotasks();
    while (sentAt.length < requests.length) {
      final timer = timers.singleWhere((candidate) => candidate.isActive);
      now = now.add(timer.duration);
      timer.fire();
      await _flushMicrotasks();
    }
    await Future.wait(requests);

    for (final start in sentAt) {
      final count = sentAt
          .where(
            (sent) =>
                !sent.isBefore(start) &&
                sent.difference(start) < const Duration(minutes: 1),
          )
          .length;
      expect(count, lessThanOrEqualTo(104));
    }
  });

  test(
    'persisted EVENT scheduler stays below 60 messages per minute',
    () async {
      var now = DateTime(2026);
      final timers = <_ManualTimer>[];
      final scheduler = RelayOperationScheduler(
        now: () => now,
        timerFactory: (duration, callback) {
          final timer = _ManualTimer(duration, callback);
          timers.add(timer);
          return timer;
        },
      );
      final sentAt = <DateTime>[];
      final publishes = [
        for (var index = 0; index < 60; index++)
          scheduler.send(
            frame: [
              'EVENT',
              {'kind': 9, 'id': '$index'},
            ],
            isCurrent: () => true,
            minimumDelayMs: () => 0,
            send: () => sentAt.add(now),
            priority: RelayOperationPriority.interactive,
          ),
      ];

      while (sentAt.length < publishes.length) {
        final timer = timers.singleWhere((candidate) => candidate.isActive);
        now = now.add(timer.duration);
        timer.fire();
        await _flushMicrotasks();
      }
      await Future.wait(publishes);

      for (final start in sentAt) {
        final count = sentAt
            .where(
              (sent) =>
                  !sent.isBefore(start) &&
                  sent.difference(start) < const Duration(minutes: 1),
            )
            .length;
        expect(count, lessThanOrEqualTo(53));
      }
    },
  );

  test('ephemeral EVENT frames use the WebSocket budget only', () async {
    var now = DateTime(2026);
    final scheduler = RelayOperationScheduler(now: () => now);
    final sentAt = <DateTime>[];
    await Future.wait([
      for (var index = 0; index < 5; index++)
        scheduler.send(
          frame: [
            'EVENT',
            {'kind': 20002, 'id': '$index'},
          ],
          isCurrent: () => true,
          minimumDelayMs: () => 0,
          send: () => sentAt.add(now),
        ),
    ]);
    expect(sentAt, List<DateTime>.filled(5, now));
    scheduler.reset();
  });
}

Future<void> _flushMicrotasks() async {
  for (var index = 0; index < 4; index++) {
    await Future<void>.delayed(Duration.zero);
  }
}

class _ManualTimer implements Timer {
  _ManualTimer(this.duration, this._callback);

  final Duration duration;
  final void Function() _callback;
  bool _active = true;

  void fire() {
    if (!_active) return;
    _active = false;
    _callback();
  }

  @override
  void cancel() => _active = false;

  @override
  bool get isActive => _active;

  @override
  int get tick => _active ? 0 : 1;
}
