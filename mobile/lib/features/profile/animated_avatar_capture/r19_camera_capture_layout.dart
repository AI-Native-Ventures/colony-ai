part of '../animated_avatar_capture.dart';

class _R19CameraCaptureLayout extends StatelessWidget {
  const _R19CameraCaptureLayout({
    required this.height,
    required this.preview,
    required this.isRecording,
    required this.isPreparing,
    required this.progress,
    required this.canRecord,
    required this.canSwitchCamera,
    required this.onRecordOrStop,
    required this.onSwitchCamera,
    required this.onAccessHelp,
  });

  final double height;
  final Widget preview;
  final bool isRecording;
  final bool isPreparing;
  final double progress;
  final bool canRecord;
  final bool canSwitchCamera;
  final VoidCallback onRecordOrStop;
  final VoidCallback onSwitchCamera;
  final VoidCallback? onAccessHelp;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final seconds = (progress * 3).floor().clamp(0, 3);
    final status = isRecording ? '● Recording · ${seconds}s' : 'Camera preview';
    final buttonLabel = isRecording ? 'Stop recording' : 'Start recording';

    return SizedBox(
      height: height,
      child: SingleChildScrollView(
        physics: const ClampingScrollPhysics(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 23),
            Container(
              height: 324,
              margin: const EdgeInsets.symmetric(horizontal: Grid.gutter),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                gradient: const LinearGradient(
                  colors: [Color(0xFFE6DDE7), Color(0xFFD2DFE2)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Stack(
                children: [
                  Positioned(
                    top: 51,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: SizedBox.square(
                        dimension: 224,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 1),
                          ),
                          child: ClipOval(
                            child: Stack(
                              fit: StackFit.expand,
                              children: [
                                ColoredBox(
                                  color: const Color(
                                    0xFFE6DDE7,
                                  ).withValues(alpha: 0.35),
                                  child: Center(child: preview),
                                ),
                                if (isRecording)
                                  Padding(
                                    padding: const EdgeInsets.all(3),
                                    child: CircularProgressIndicator(
                                      value: progress,
                                      strokeWidth: 3,
                                      color: context.mobileTokens.ink
                                          .withValues(alpha: 0.82),
                                      backgroundColor: Colors.white.withValues(
                                        alpha: 0.35,
                                      ),
                                    ),
                                  ),
                                const IgnorePointer(
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      border: Border.fromBorderSide(
                                        BorderSide(
                                          color: Colors.white,
                                          width: 1,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 14,
                    child: Center(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: const Color(0xFFF2F4F5),
                          borderRadius: BorderRadius.circular(Radii.full),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: Grid.xs,
                            vertical: Grid.xxs,
                          ),
                          child: Text(
                            status,
                            style: context.textTheme.labelSmall?.copyWith(
                              color: const Color(0xFF4B4652),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            // The frozen review shows a simulated-camera note here. The native
            // route uses a real camera, so retain its spacing without shipping
            // the review-only disclaimer as production copy.
            const SizedBox(height: 48),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Grid.gutter),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 121,
                    height: 44,
                    child: Material(
                      color: Theme.of(context).brightness == Brightness.dark
                          ? const Color(0xFF312B38)
                          : const Color(0xFFF6F4F6),
                      borderRadius: BorderRadius.circular(10),
                      child: IconButton(
                        tooltip: 'Switch camera',
                        onPressed: canSwitchCamera ? onSwitchCamera : null,
                        icon: const Icon(Icons.refresh, size: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  SizedBox(
                    width: 120,
                    height: 60,
                    child: FilledButton(
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF382D46),
                        foregroundColor: Colors.white,
                        disabledForegroundColor: Colors.white.withValues(
                          alpha: 0.72,
                        ),
                        disabledBackgroundColor: const Color(
                          0xFF382D46,
                        ).withValues(alpha: 0.28),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: Grid.xs,
                        ),
                      ),
                      onPressed: !canRecord || isPreparing
                          ? null
                          : onRecordOrStop,
                      child: Text(
                        buttonLabel,
                        textAlign: TextAlign.center,
                        style: context.textTheme.labelMedium?.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: Grid.xxs),
                  Expanded(
                    child: TextButton(
                      style: TextButton.styleFrom(
                        minimumSize: const Size(0, 60),
                        padding: const EdgeInsets.symmetric(horizontal: 2),
                        foregroundColor: colors.primary,
                        textStyle: bodyExtraSmallTextStyle,
                      ),
                      onPressed: onAccessHelp,
                      child: const Text('Access help'),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                Grid.gutter,
                Grid.xs,
                Grid.gutter,
                Grid.xl,
              ),
              child: Text(
                'A short loop. Review it before updating your avatar.',
                style: bodyExtraSmallTextStyle.copyWith(
                  color: context.mobileTokens.muted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
