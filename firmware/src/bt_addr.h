#ifndef YACC_BT_ADDR_H_
#define YACC_BT_ADDR_H_
// The guitar's BLE identity (static random address) for one mode. Pure, so the host tests can run it.
// rot is the mode's address counter. 0.49-0.51 bumped it on every pairing mode; since 0.52 nothing changes it, it is only
// read so that the address those versions reached stays (0 = the address of every firmware before 0.49).
#include <stdint.h>
static inline void bt_identity_addr(const uint8_t uid[8], uint8_t mode, uint16_t rot, uint8_t out[6]) {
    for (int i = 0; i < 6; i++) out[i] = uid[2 + i];
    out[5] ^= (uint8_t)(mode * 0x2B + 1);
    out[4] ^= 0x3E;                         // v0.22: per-mode IRKs, so every mode is paired fresh
    out[3] ^= (uint8_t)rot;
    out[2] ^= (uint8_t)(rot >> 8);
    out[0] |= 0xC0;                         // static random: top two bits set
}
#endif
