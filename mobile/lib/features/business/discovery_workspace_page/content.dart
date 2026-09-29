part of '../discovery_workspace_page.dart';

class _DiscoveryWorkspaceContent extends StatelessWidget {
  const _DiscoveryWorkspaceContent({
    required this.records,
    required this.query,
    required this.selectedStage,
    required this.onQueryChanged,
    required this.onStageChanged,
  });

  final MobileDiscoveryRecords records;
  final String query;
  final String selectedStage;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<String> onStageChanged;

  @override
  Widget build(BuildContext context) {
    final prospects = records.prospects.toList()..sort(_bestFitFirst);
    final stageValues =
        prospects
            .map((record) => record.objectValue('prospect')?['stage'])
            .whereType<String>()
            .toSet()
            .toList()
          ..sort();
    final normalizedQuery = query.trim().toLowerCase();
    final visibleProspects = prospects.where((record) {
      final prospect = record.objectValue('prospect') ?? const {};
      final party = _readObject(prospect['party']) ?? const {};
      final stage = prospect['stage'];
      if (selectedStage != 'all' && stage != selectedStage) return false;
      if (normalizedQuery.isEmpty) return true;
      return [
        party['displayName'],
        prospect['industry'],
        prospect['vertical'],
        prospect['location'],
        prospect['contactName'],
        prospect['email'],
        prospect['phone'],
      ].whereType<String>().any(
        (value) => value.toLowerCase().contains(normalizedQuery),
      );
    }).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
      children: [
        Text(
          'Every relationship.\nOne place.',
          style: context.textTheme.headlineMedium?.copyWith(
            color: context.mobileTokens.ink,
            fontWeight: FontWeight.w800,
            height: 1.12,
            letterSpacing: -0.8,
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          key: const ValueKey('discovery-lead-search'),
          style: context.textTheme.bodySmall,
          onChanged: onQueryChanged,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            prefixIcon: const Icon(Icons.search),
            hintText: 'Name, location or contact',
            hintStyle: context.textTheme.bodySmall,
            filled: true,
            fillColor: context.mobileTokens.paper,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(13)),
          ),
        ),
        const SizedBox(height: 16),
        Text('Show', style: context.textTheme.labelSmall),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          key: ValueKey('discovery-stage-filter-$selectedStage'),
          initialValue: stageValues.contains(selectedStage)
              ? selectedStage
              : 'all',
          style: context.textTheme.bodySmall,
          decoration: InputDecoration(
            filled: true,
            fillColor: context.mobileTokens.paper,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(13)),
          ),
          items: [
            const DropdownMenuItem(value: 'all', child: Text('All prospects')),
            for (final stage in stageValues)
              DropdownMenuItem(value: stage, child: Text(_humanize(stage))),
          ],
          onChanged: (value) {
            if (value != null) onStageChanged(value);
          },
        ),
        const SizedBox(height: 20),
        if (visibleProspects.isNotEmpty)
          Text(
            '${visibleProspects.length} ${visibleProspects.length == 1 ? 'prospect' : 'prospects'}',
            style: context.textTheme.labelSmall?.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
        const SizedBox(height: 2),
        if (visibleProspects.isEmpty)
          const _DiscoveryEmptyState()
        else
          for (final record in visibleProspects)
            _DiscoveryRecordTile(
              key: ValueKey(record.event.id),
              record: record,
            ),
      ],
    );
  }
}

int _bestFitFirst(MobileBusinessRecord left, MobileBusinessRecord right) {
  final leftProspect = left.objectValue('prospect') ?? const {};
  final rightProspect = right.objectValue('prospect') ?? const {};
  final leftScore = leftProspect['fitScore'];
  final rightScore = rightProspect['fitScore'];
  if (leftScore is int && rightScore is int && leftScore != rightScore) {
    return rightScore.compareTo(leftScore);
  }
  if (leftScore is int && rightScore == null) return -1;
  if (leftScore == null && rightScore is int) return 1;
  return right.event.createdAt.compareTo(left.event.createdAt);
}

class _DiscoveryRecordTile extends StatelessWidget {
  const _DiscoveryRecordTile({required this.record, super.key});

  final MobileBusinessRecord record;

  @override
  Widget build(BuildContext context) {
    final prospect = record.objectValue('prospect') ?? const {};
    final party = _readObject(prospect['party']) ?? const {};
    final name = _stringOr(party['displayName'], 'Prospect');
    final score = prospect['fitScore'];
    final tokens = context.mobileTokens;
    final subtitle = [
      prospect['industry'],
      prospect['vertical'],
      prospect['location'],
    ].whereType<String>().where((value) => value.trim().isNotEmpty).join(' · ');
    void openDetail() {
      unawaited(
        Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => _DiscoveryProspectDetailPage(record: record),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.line)),
      ),
      child: Semantics(
        button: true,
        label: [
          name,
          subtitle,
          if (score is int) '$score fit score',
        ].where((value) => value.isNotEmpty).join('. '),
        onTap: openDetail,
        child: ExcludeSemantics(
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: openDetail,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.textTheme.bodyMedium?.copyWith(
                              color: tokens.ink,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          if (subtitle.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              subtitle,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: context.textTheme.bodySmall?.copyWith(
                                color: tokens.muted,
                                height: 1.45,
                              ),
                            ),
                          ],
                          if (prospect['stage'] is String) ...[
                            const SizedBox(height: 8),
                            _ProspectStageTag(
                              stage: prospect['stage'] as String,
                            ),
                          ],
                        ],
                      ),
                    ),
                    if (score is int) ...[
                      const SizedBox(width: 12),
                      Text(
                        '$score',
                        style: context.textTheme.titleSmall?.copyWith(
                          color: context.appColors.success,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(left: 4, top: 4),
                        child: Text(
                          'fit',
                          style: context.textTheme.labelSmall?.copyWith(
                            color: tokens.muted,
                          ),
                        ),
                      ),
                    ],
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

class _DiscoveryProspectDetailPage extends StatelessWidget {
  const _DiscoveryProspectDetailPage({required this.record});

  final MobileBusinessRecord record;

  @override
  Widget build(BuildContext context) {
    final prospect = record.objectValue('prospect') ?? const {};
    final party = _readObject(prospect['party']) ?? const {};
    final evidence = (prospect['evidence'] as List? ?? const [])
        .whereType<Map>()
        .toList();
    final activities = (record.value['activities'] as List? ?? const [])
        .whereType<Map>()
        .toList();
    final score = prospect['fitScore'];
    final name = _stringOr(party['displayName'], 'Prospect');
    final tokens = context.mobileTokens;

    return Material(
      color: tokens.canvas,
      child: Column(
        children: [
          _BusinessPageHeader(
            title: 'Prospect',
            onBack: () => unawaited(Navigator.of(context).maybePop()),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
              children: [
                Row(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: tokens.soft,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Text(
                        _initials(name),
                        style: context.textTheme.titleMedium?.copyWith(
                          color: context.appColors.success,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const Spacer(),
                    if (score is int)
                      Text(
                        '$score  fit score',
                        style: context.textTheme.labelMedium?.copyWith(
                          color: tokens.action,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 18),
                Text(
                  name,
                  style: context.textTheme.headlineMedium?.copyWith(
                    color: tokens.ink,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.7,
                  ),
                ),
                const SizedBox(height: 6),
                if (prospect['industry'] is String)
                  Text(
                    prospect['industry'] as String,
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: tokens.muted,
                    ),
                  ),
                if (prospect['vertical'] is String ||
                    prospect['location'] is String)
                  Text(
                    [prospect['vertical'], prospect['location']]
                        .whereType<String>()
                        .where((value) => value.trim().isNotEmpty)
                        .join(', '),
                    style: context.textTheme.bodyMedium?.copyWith(
                      color: tokens.muted,
                    ),
                  ),
                if (prospect['stage'] is String) ...[
                  const SizedBox(height: 12),
                  _ProspectStageTag(stage: prospect['stage'] as String),
                ],
                if (evidence.isNotEmpty) ...[
                  const SizedBox(height: 26),
                  Text(
                    'WHY THIS COULD BE A FIT',
                    style: context.textTheme.labelLarge?.copyWith(
                      color: tokens.muted,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.4,
                    ),
                  ),
                  const SizedBox(height: 10),
                  for (final item in evidence)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _ProspectEvidenceCard(evidence: item),
                    ),
                ],
                const SizedBox(height: 18),
                for (final field in _prospectFields(prospect))
                  _DiscoveryDetailRow(label: field.$1, value: field.$2),
                if (activities.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  Text(
                    'Notes',
                    style: context.textTheme.titleSmall?.copyWith(
                      color: tokens.ink,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  for (final activity in activities)
                    if (activity['content'] is String)
                      _DiscoveryDetailRow(
                        label: _humanize(
                          _stringOr(activity['activityKind'], 'note'),
                        ),
                        value: activity['content'] as String,
                      ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

List<(String, String)> _prospectFields(Map<String, Object?> prospect) => [
  if (prospect['qualification'] is String)
    ('Qualification', _humanize(prospect['qualification'] as String)),
  if (prospect['contactName'] is String)
    ('Contact', prospect['contactName'] as String),
  if (prospect['email'] is String) ('Email', prospect['email'] as String),
  if (prospect['phone'] is String) ('Phone', prospect['phone'] as String),
  if (prospect['website'] is String) ('Website', prospect['website'] as String),
  if (prospect['lastVerifiedAt'] is int)
    ('Last checked', _formatDate(prospect['lastVerifiedAt'] as int)),
];

class _ProspectEvidenceCard extends StatelessWidget {
  const _ProspectEvidenceCard({required this.evidence});

  final Map evidence;

  @override
  Widget build(BuildContext context) {
    final tokens = context.mobileTokens;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tokens.paper,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: tokens.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (evidence['title'] is String)
            Text(
              evidence['title'] as String,
              style: context.textTheme.titleSmall?.copyWith(
                color: tokens.ink,
                fontWeight: FontWeight.w700,
              ),
            ),
          if (evidence['excerpt'] is String) ...[
            const SizedBox(height: 5),
            SelectableText(
              evidence['excerpt'] as String,
              style: context.textTheme.bodySmall?.copyWith(
                color: tokens.muted,
                height: 1.5,
              ),
            ),
          ],
          if (evidence['url'] is String) ...[
            const SizedBox(height: 5),
            SelectableText(
              evidence['url'] as String,
              style: context.textTheme.labelSmall?.copyWith(
                color: tokens.action,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ProspectStageTag extends StatelessWidget {
  const _ProspectStageTag({required this.stage});

  final String stage;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: context.mobileTokens.soft,
      borderRadius: BorderRadius.circular(7),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Text(
        _humanize(stage),
        style: context.textTheme.labelSmall?.copyWith(
          color: context.mobileTokens.muted,
        ),
      ),
    ),
  );
}

class _DiscoveryDetailRow extends StatelessWidget {
  const _DiscoveryDetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: SelectableText(
            value,
            textAlign: TextAlign.end,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.ink,
            ),
          ),
        ),
      ],
    ),
  );
}

class _DiscoveryEmptyState extends StatelessWidget {
  const _DiscoveryEmptyState();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 22),
    child: Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.mobileTokens.paper,
        border: Border.all(color: context.mobileTokens.line),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Text(
        'No prospects yet',
        style: context.textTheme.titleSmall?.copyWith(
          color: context.mobileTokens.ink,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

class _BusinessPageHeader extends StatelessWidget {
  const _BusinessPageHeader({required this.title, required this.onBack});

  final String title;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) => SafeArea(
    bottom: false,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(height: 24),
        SizedBox(
          height: 68,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 18),
            child: Row(
              children: [
                Semantics(
                  button: true,
                  label: 'Back to company',
                  onTap: onBack,
                  child: ExcludeSemantics(
                    child: IconButton.filledTonal(
                      onPressed: onBack,
                      icon: const Icon(Icons.arrow_back),
                      style: IconButton.styleFrom(
                        backgroundColor: context.mobileTokens.paper,
                        foregroundColor: context.mobileTokens.ink,
                        side: BorderSide(color: context.mobileTokens.line),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    title,
                    style: context.textTheme.titleLarge?.copyWith(
                      color: context.mobileTokens.ink,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                      fontSize: 20,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

class _BusinessLoadError extends StatelessWidget {
  const _BusinessLoadError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.work_outline,
            size: 40,
            color: context.mobileTokens.action,
          ),
          const SizedBox(height: 18),
          Text(
            'Discovery could not load',
            textAlign: TextAlign.center,
            style: context.textTheme.titleLarge?.copyWith(
              color: context.mobileTokens.ink,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'The connected source is unavailable. Existing work is kept, and missing data is not shown as zero.',
            textAlign: TextAlign.center,
            style: context.textTheme.bodySmall?.copyWith(
              color: context.mobileTokens.muted,
              height: 1.55,
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: onRetry,
              child: const Text('Retry connection'),
            ),
          ),
        ],
      ),
    ),
  );
}

Map<String, Object?>? _readObject(Object? value) {
  if (value is! Map) return null;
  return value.map((key, value) => MapEntry(key as String, value));
}

String _stringOr(Object? value, String fallback) =>
    value is String && value.trim().isNotEmpty ? value : fallback;

String _humanize(String value) => value
    .replaceAll('_', ' ')
    .split(' ')
    .map((word) {
      if (word.isEmpty) return word;
      return '${word[0].toUpperCase()}${word.substring(1)}';
    })
    .join(' ');

String _formatDate(int timestamp) => DateTime.fromMillisecondsSinceEpoch(
  timestamp * 1000,
).toLocal().toString().split(' ').first;

String _initials(String value) {
  final words = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty);
  return words
      .take(2)
      .map((word) => word.characters.first.toUpperCase())
      .join();
}
