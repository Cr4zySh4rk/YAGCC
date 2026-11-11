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


// Stale host guard (0.52). The first thing a host does on the security level of a connection decides whether it may pair
// during a pairing window: a host that opens with an encryption attempt for a key we no longer have still believes it is
// bonded (it is the previous host reconnecting by itself), a host that opens with a Pairing Request has had the guitar
// removed from its list (or is new). Only the first of these is refused.
typedef enum { BT_SEC_NONE = 0, BT_SEC_REENC_OK, BT_SEC_REENC_MISSING_KEY, BT_SEC_PAIRING_REQUEST } bt_first_sec_t;
typedef enum { BT_SEC_EV_LTK_REQUEST, BT_SEC_EV_REENC_STARTED, BT_SEC_EV_PAIRING_REQUEST } bt_sec_event_t;

// LTK request: BTstack raises nothing for a miss, so it counts as a miss until REENC_STARTED (key found, reply sent)
// follows. Later events never change the first verdict, except that "found" corrects a pending "missing".
static inline bt_first_sec_t bt_first_sec_next(bt_first_sec_t cur, bt_sec_event_t ev) {
    if (cur == BT_SEC_NONE)
        return ev == BT_SEC_EV_LTK_REQUEST ? BT_SEC_REENC_MISSING_KEY : ev == BT_SEC_EV_REENC_STARTED ? BT_SEC_REENC_OK : BT_SEC_PAIRING_REQUEST;
    if (cur == BT_SEC_REENC_MISSING_KEY && ev == BT_SEC_EV_REENC_STARTED) return BT_SEC_REENC_OK;
    return cur;
}
// May this connection pair? Outside a pairing window always (a host that lost its keys pairs again, as before).
static inline bool bt_accept_pairing(bool window_open, bt_first_sec_t first) { return !(window_open && first == BT_SEC_REENC_MISSING_KEY); }

#endif
