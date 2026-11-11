// Host test for the Bluetooth pairing / advertising decisions (bt_policy.h).
#include <stdio.h>
#include <string.h>
#include "bt_policy.h"
static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)
int main(void) {
    // never unreachable: without a valid bond the guitar is discoverable, with or without a pairing window
    CHECK(bt_adv_discoverable(false, false));
    CHECK(bt_adv_discoverable(false, true));
    // "paired hosts only" (slow advertising) exactly when a valid bond exists and no window is open
    CHECK(!bt_adv_discoverable(true, false));
    CHECK(bt_adv_discoverable(true, true));
    // a key counts only when it is not all zero
    uint8_t k[16]; memset(k, 0, sizeof(k));
    CHECK(!bt_ltk_valid(k));
    for (int i = 0; i < 16; i++) { memset(k, 0, sizeof(k)); k[i] = 1; CHECK(bt_ltk_valid(k)); }
    // pairing that failed before a key existed leaves no bond; one that failed over an older real key keeps it;
    // success keeps the entry
    CHECK(!bt_bond_survives(0x05, false));
    CHECK(!bt_bond_survives(0x08, false));
    CHECK(bt_bond_survives(0x05, true));
    CHECK(bt_bond_survives(0x00, true));
    CHECK(bt_bond_survives(0x00, false));
    // the sequence from the hardware log: a bond-less guitar whose pairing never completed advertises discoverable
    bool has_bond = false;                                   // pairing never reached SM_EVENT_PAIRING_COMPLETE success
    CHECK(bt_adv_discoverable(has_bond, false));
    has_bond = bt_ltk_valid(k) && bt_bond_survives(0x00, true);   // a completed pairing
    CHECK(!bt_adv_discoverable(has_bond, false));
    // stale host guard: pairing is refused only inside a window, for a link whose first security action was a re-encryption
    // with a key we no longer have
    bt_first_sec_t f;
    for (int w = 0; w < 2; w++) {
        CHECK(bt_accept_pairing(w, BT_SEC_NONE));
        CHECK(bt_accept_pairing(w, BT_SEC_REENC_OK));
        CHECK(bt_accept_pairing(w, BT_SEC_PAIRING_REQUEST));
    }
    CHECK(!bt_accept_pairing(true, BT_SEC_REENC_MISSING_KEY));
    CHECK(bt_accept_pairing(false, BT_SEC_REENC_MISSING_KEY));       // outside a window a host that lost its keys pairs again
    // old Mac: LTK request nobody answers, then it pairs by itself -> refused; the Pairing Request does not make it a fresh host
    f = bt_first_sec_next(BT_SEC_NONE, BT_SEC_EV_LTK_REQUEST);
    CHECK(f == BT_SEC_REENC_MISSING_KEY);
    f = bt_first_sec_next(f, BT_SEC_EV_PAIRING_REQUEST);
    CHECK(f == BT_SEC_REENC_MISSING_KEY && !bt_accept_pairing(true, f));
    // fresh Windows: opens with the Pairing Request (even if it asks for encryption after) -> accepted
    f = bt_first_sec_next(BT_SEC_NONE, BT_SEC_EV_PAIRING_REQUEST);
    f = bt_first_sec_next(f, BT_SEC_EV_LTK_REQUEST);
    CHECK(f == BT_SEC_PAIRING_REQUEST && bt_accept_pairing(true, f));
    // bonded host reconnecting inside a window: LTK request answered (REENC_STARTED) -> not stale
    f = bt_first_sec_next(BT_SEC_NONE, BT_SEC_EV_LTK_REQUEST);
    f = bt_first_sec_next(f, BT_SEC_EV_REENC_STARTED);
    CHECK(f == BT_SEC_REENC_OK && bt_accept_pairing(true, f));
    // host with a key we hold that pairs directly: REENC_STARTED/COMPLETE(missing) then PAIRING_STARTED -> accepted
    f = bt_first_sec_next(BT_SEC_NONE, BT_SEC_EV_REENC_STARTED);
    f = bt_first_sec_next(f, BT_SEC_EV_PAIRING_REQUEST);
    CHECK(f == BT_SEC_REENC_OK && bt_accept_pairing(true, f));
    if (fails) return 1;
    puts("bt_policy_test OK");
    return 0;
}
