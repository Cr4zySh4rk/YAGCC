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
    if (fails) return 1;
    puts("bt_policy_test OK");
    return 0;
}
