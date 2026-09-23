import 'package:hooks_riverpod/hooks_riverpod.dart';

import '../../shared/community/community_provider.dart';
import 'account_api.dart';
import 'account_auth_types.dart';

/// Checks whether the active identity is already linked to an account.
final accountLinkStatusProvider =
    AsyncNotifierProvider<AccountLinkStatusNotifier, AccountLinkState>(
      AccountLinkStatusNotifier.new,
    );

/// Checks account linkage in the background without gating local app use.
class AccountLinkStatusNotifier extends AsyncNotifier<AccountLinkState> {
  @override
  Future<AccountLinkState> build() async {
    final community = await ref.watch(activeCommunityProvider.future);
    final nsec = community?.nsec;
    if (nsec == null || nsec.isEmpty) {
      return const AccountLinkState(AccountLinkStatus.linked);
    }
    try {
      await ref.watch(accountApiProvider).me(nsec: nsec);
      return const AccountLinkState(AccountLinkStatus.linked);
    } on AccountAuthFailure catch (failure) {
      if (failure.kind == AccountAuthFailureKind.accountMissing) {
        return const AccountLinkState(AccountLinkStatus.needsClaim);
      }
      return const AccountLinkState(AccountLinkStatus.tryAgainLater);
    } catch (_) {
      return const AccountLinkState(AccountLinkStatus.tryAgainLater);
    }
  }
}
