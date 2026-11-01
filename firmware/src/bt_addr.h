#ifndef YACC_BT_ADDR_H_
#define YACC_BT_ADDR_H_
// The guitar's BLE identity (static random address) for one mode. Pure, so the host tests can run it.
// rot is the mode's rotation counter: pairing mode bumps it, which gives the guitar a new address (and, with
// the identity root deleted, a new IRK), so a host paired before no longer finds the device it knows.
// rot = 0 is the address every earlier firmware used, so existing pairings survive the update.
#include <stdint.h>
static inline void bt_identity_addr(const uint8_t uid[8], uint8_t mode, uint16_t rot, uint8_t out[6]) {
    for (int i = 0; i < 6; i++) out[i] = uid[2 + i];
    out[5] ^= (uint8_t)(mode * 0x2B + 1);
    out[4] ^= 0x3E;                         // v0.22: per-mode IRKs, so every mode is paired fresh
    out[3] ^= (uint8_t)rot;
    out[2] ^= (uint8_t)(rot >> 8);
    out[0] |= 0xC0;                         // static random: top two bits set
}
// Rotation counter after pairing mode (stored value of 0xFFFF or garbage restarts from 1)
static inline uint16_t bt_next_rot(int stored_len, const uint8_t *stored) {
    uint16_t r = stored_len == 2 ? (uint16_t)(stored[0] | (stored[1] << 8)) : 0;
    return (uint16_t)(r + 1);
}
#endif
