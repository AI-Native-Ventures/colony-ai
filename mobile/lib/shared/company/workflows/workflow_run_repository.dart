import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../relay/relay.dart';
import 'workflow_records.dart';

const _workflowRunResponseLimit = 1024 * 1024;

@immutable
class WorkflowRunRecord {
  const WorkflowRunRecord({
    required this.id,
    required this.workflowId,
    required this.status,
    required this.createdAt,
    this.definitionVersion,
    this.currentStep,
    this.executionTrace = const [],
    this.startedAt,
    this.completedAt,
    this.errorCode,
    this.errorMessage,
  });

  final String id;
  final String workflowId;
  final String status;
  final int createdAt;
  final String? definitionVersion;
  final int? currentStep;
  final List<WorkflowTraceRecord> executionTrace;
  final int? startedAt;
  final int? completedAt;
  final String? errorCode;
  final String? errorMessage;
}

@immutable
class WorkflowTraceRecord {
  const WorkflowTraceRecord({
    required this.stepId,
    required this.status,
    this.output = const {},
    this.error,
  });

  final String stepId;
  final String status;
  final Map<String, Object?> output;
  final String? error;
}

@immutable
class WorkflowApprovalRecord {
  const WorkflowApprovalRecord({
    required this.approvalRef,
    required this.workflowId,
    required this.runId,
    required this.stepId,
    required this.stepIndex,
    required this.approverSpec,
    required this.status,
    required this.expiresAt,
    this.approverPubkey,
    this.note,
  });

  /// The relay's one-use token hash. It is never accepted as a bearer token.
  final String approvalRef;
  final String workflowId;
  final String runId;
  final String stepId;
  final int stepIndex;
  final String approverSpec;
  final String status;
  final String expiresAt;
  final String? approverPubkey;
  final String? note;
}

abstract interface class WorkflowRunGateway {
  Future<List<WorkflowRunRecord>> loadRuns(String workflowId);

  Future<List<WorkflowApprovalRecord>> loadApprovals({
    required String workflowId,
    required String runId,
  });
}

final workflowRunHttpClientProvider = Provider<http.Client>((ref) {
  final client = http.Client();
  ref.onDispose(client.close);
  return client;
});

final workflowRunGatewayProvider = Provider<WorkflowRunGateway>((ref) {
  final config = ref.watch(relayConfigProvider);
  return RelayWorkflowRunGateway(
    baseUrl: config.baseUrl,
    nsec: config.nsec,
    client: ref.watch(workflowRunHttpClientProvider),
  );
});

final workflowRunsProvider = FutureProvider.autoDispose
    .family<List<WorkflowRunRecord>, String>((ref, workflowId) async {
      ref.watch(relayConfigProvider);
      return ref.watch(workflowRunGatewayProvider).loadRuns(workflowId);
    });

final workflowApprovalsProvider = FutureProvider.autoDispose
    .family<List<WorkflowApprovalRecord>, (String, String)>((ref, query) async {
      ref.watch(relayConfigProvider);
      return ref
          .watch(workflowRunGatewayProvider)
          .loadApprovals(workflowId: query.$1, runId: query.$2);
    });

class RelayWorkflowRunGateway implements WorkflowRunGateway {
  const RelayWorkflowRunGateway({
    required this.baseUrl,
    required this.nsec,
    required this.client,
  });

  final String baseUrl;
  final String? nsec;
  final http.Client client;

  @override
  Future<List<WorkflowRunRecord>> loadRuns(String workflowId) async {
    _validateUuid(workflowId, 'workflowId');
    final uri = _apiUri(
      baseUrl,
      '/workflows/${workflowId.toLowerCase()}/runs?limit=20',
    );
    final payload = await _getJson(uri);
    final values = payload['runs'];
    if (values is! List<Object?>) {
      throw const FormatException('Workflow run history is not available.');
    }
    return List.unmodifiable([
      for (final value in values) _parseRun(value, workflowId.toLowerCase()),
    ]);
  }

  @override
  Future<List<WorkflowApprovalRecord>> loadApprovals({
    required String workflowId,
    required String runId,
  }) async {
    _validateUuid(workflowId, 'workflowId');
    _validateUuid(runId, 'runId');
    final uri = _apiUri(
      baseUrl,
      '/workflows/${workflowId.toLowerCase()}/runs/${runId.toLowerCase()}/approvals',
    );
    final payload = await _getJson(uri);
    final values = payload['approvals'];
    if (values is! List<Object?>) {
      throw const FormatException('Workflow approval state is not available.');
    }
    return List.unmodifiable([
      for (final value in values)
        _parseApproval(value, workflowId.toLowerCase(), runId.toLowerCase()),
    ]);
  }

  Future<Map<String, Object?>> _getJson(Uri uri) async {
    final request = http.Request('GET', uri)
      ..followRedirects = false
      ..headers.addAll({
        'Accept': 'application/json',
        'Authorization': buildNip98AuthHeader(
          method: 'GET',
          url: uri.toString(),
          bodyBytes: const [],
          nsec: nsec,
        ),
      });
    final response = await client
        .send(request)
        .timeout(const Duration(seconds: 10));
    final bytes = await _readBounded(response);
    final body = utf8.decode(bytes, allowMalformed: false);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(_relayError(body, response.statusCode));
    }
    final value = jsonDecode(body);
    if (value is! Map<String, dynamic>) {
      throw const FormatException('The workflow response is invalid.');
    }
    return value;
  }
}

Uri _apiUri(String baseUrl, String path) {
  final base = Uri.tryParse(baseUrl);
  if (base == null || base.host.isEmpty) {
    throw const FormatException('The active relay URL is invalid.');
  }
  final scheme = switch (base.scheme) {
    'wss' => 'https',
    'ws' => 'http',
    'https' || 'http' => base.scheme,
    _ => throw const FormatException('The active relay URL is invalid.'),
  };
  return base.replace(scheme: scheme, path: path, query: null, fragment: null);
}

Future<List<int>> _readBounded(http.StreamedResponse response) async {
  final bytes = <int>[];
  await for (final chunk in response.stream) {
    if (bytes.length + chunk.length > _workflowRunResponseLimit) {
      throw const FormatException('The workflow response is too large.');
    }
    bytes.addAll(chunk);
  }
  return bytes;
}

WorkflowRunRecord _parseRun(Object? value, String workflowId) {
  final map = _map(value, 'workflow run');
  final id = _requiredString(map, 'id');
  final actualWorkflowId = _requiredString(map, 'workflow_id').toLowerCase();
  final status = _requiredString(map, 'status');
  final version = map['definition_version'];
  final trace = map['execution_trace'];
  if (!_isUuid(id) ||
      actualWorkflowId != workflowId ||
      !_runStatuses.contains(status) ||
      (version != null && !_isHex64(version)) ||
      trace is! List<Object?>) {
    throw const FormatException('The relay returned an invalid workflow run.');
  }
  return WorkflowRunRecord(
    id: id.toLowerCase(),
    workflowId: actualWorkflowId,
    status: status,
    createdAt: _requiredInt(map, 'created_at'),
    definitionVersion: (version as String?)?.toLowerCase(),
    currentStep: _optionalInt(map['current_step']),
    executionTrace: List.unmodifiable([
      for (final row in trace) _parseTrace(row),
    ]),
    startedAt: _optionalInt(map['started_at']),
    completedAt: _optionalInt(map['completed_at']),
    errorCode: _optionalString(map['error_code']),
    errorMessage: _optionalString(map['error_message']),
  );
}

WorkflowTraceRecord _parseTrace(Object? value) {
  final map = _map(value, 'workflow trace entry');
  final stepId = _requiredString(map, 'step_id');
  final status = _requiredString(map, 'status');
  final output = map['output'];
  if (output is! Map<String, dynamic>) {
    throw const FormatException(
      'The relay returned an invalid workflow trace.',
    );
  }
  return WorkflowTraceRecord(
    stepId: stepId,
    status: status,
    output: Map.unmodifiable(output),
    error: _optionalString(map['error']),
  );
}

WorkflowApprovalRecord _parseApproval(
  Object? value,
  String workflowId,
  String runId,
) {
  final map = _map(value, 'workflow approval');
  final approvalRef = _requiredString(map, 'approval_ref').toLowerCase();
  final actualWorkflowId = _requiredString(map, 'workflow_id').toLowerCase();
  final actualRunId = _requiredString(map, 'run_id').toLowerCase();
  final stepId = _requiredString(map, 'step_id');
  final stepIndex = _requiredInt(map, 'step_index');
  final approverSpec = _requiredString(map, 'approver_spec');
  final status = _requiredString(map, 'status');
  final expiresAt = _requiredString(map, 'expires_at');
  final approver = _optionalString(map['approver_pubkey']);
  if (!_isHex64(approvalRef) ||
      actualWorkflowId != workflowId ||
      actualRunId != runId ||
      stepIndex < 0 ||
      !_approvalStatuses.contains(status) ||
      DateTime.tryParse(expiresAt) == null ||
      (approver != null && !_isHex64(approver))) {
    throw const FormatException('The relay returned an invalid approval.');
  }
  return WorkflowApprovalRecord(
    approvalRef: approvalRef,
    workflowId: actualWorkflowId,
    runId: actualRunId,
    stepId: stepId,
    stepIndex: stepIndex,
    approverSpec: approverSpec,
    status: status,
    expiresAt: expiresAt,
    approverPubkey: approver?.toLowerCase(),
    note: _optionalString(map['note']),
  );
}

Map<String, dynamic> _map(Object? value, String label) {
  if (value is Map<String, dynamic>) return value;
  throw FormatException('The relay returned an invalid $label.');
}

String _requiredString(Map<String, dynamic> map, String key) {
  final value = map[key];
  if (value is String && value.isNotEmpty) return value;
  throw FormatException('The relay response is missing $key.');
}

String? _optionalString(Object? value) => value is String ? value : null;

int _requiredInt(Map<String, dynamic> map, String key) {
  final value = map[key];
  if (value is int) return value;
  throw FormatException('The relay response is missing $key.');
}

int? _optionalInt(Object? value) => value is int ? value : null;

bool _isUuid(String value) => isWorkflowId(value);

bool _isHex64(Object? value) =>
    value is String &&
    RegExp(r'^[0-9a-f]{64}$', caseSensitive: false).hasMatch(value);

void _validateUuid(String value, String name) {
  if (!_isUuid(value)) {
    throw ArgumentError.value(value, name, 'Expected a UUID');
  }
}

String _relayError(String body, int statusCode) {
  try {
    final value = jsonDecode(body);
    if (value is Map<String, dynamic>) {
      final message = value['error'] ?? value['message'];
      if (message is String && message.trim().isNotEmpty) return message.trim();
    }
  } on FormatException {
    // Keep the status if the relay does not return a JSON error body.
  }
  return 'Workflow request failed with HTTP $statusCode.';
}

const _runStatuses = {
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'waiting_approval',
};

const _approvalStatuses = {'pending', 'granted', 'denied', 'expired'};
