#ifndef YACC_BT_POLICY_H_
#define YACC_BT_POLICY_H_
// Pure Bluetooth pairing / advertising decisions (no SDK, so tests/host_map runs them).
#include <stdint.h>
#include <stdbool.h>

// A stored key counts only when it is not all zero (an empty device database slot reads back as zeros)
static inline bool bt_ltk_valid(const uint8_t ltk[16]) {
    for (int i = 0; i < 16; i++) if (ltk[i]) return true;
    return false;
}

// How the guitar advertises. With no valid bond for the running mode it is always discoverable (fast advertising
// interval), pairing window or not: otherwise a pairing that never completed would leave a guitar nobody can find
// again. With a valid bond it advertises slowly for that host, and fast only inside a pairing window.
static inline bool bt_adv_discoverable(bool has_valid_bond, bool window_open) { return window_open || !has_valid_bond; }

// A device database entry written while pairing is kept only if the pairing finished (status 0) or the entry holds a
// real key from an earlier pairing. A failed first pairing leaves nothing that looks like a pairing.
static inline bool bt_bond_survives(uint8_t pairing_status, bool entry_has_ltk) { return entry_has_ltk || pairing_status == 0; }

#endif
