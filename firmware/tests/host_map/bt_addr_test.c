// Host test for the Bluetooth identity rotation (bt_addr.h): pairing mode must give a new address.
#include <stdio.h>
#include <string.h>
#include "bt_addr.h"
static int fails;
#define CHECK(c) do { if (!(c)) { printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); fails++; } } while (0)
int main(void) {
    const uint8_t uid[8] = {0xE6, 0x61, 0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC};
    uint8_t a[6], b[6];
    // rot 0 is the address of firmware up to 0.48 (existing pairings keep working)
    for (int m = 0; m < 12; m++) {
        uint8_t legacy[6]; for (int i = 0; i < 6; i++) legacy[i] = uid[2 + i];
        legacy[5] ^= (uint8_t)(m * 0x2B + 1); legacy[4] ^= 0x3E; legacy[0] |= 0xC0;
        bt_identity_addr(uid, (uint8_t)m, 0, a);
        CHECK(memcmp(a, legacy, 6) == 0);
    }
    // every rotation of a mode is a different, valid static random address; no mode collides with another
    static uint8_t seen[12 * 2000][6];
    int n = 0;
    for (int m = 0; m < 12; m++) for (int r = 0; r < 2000; r++) {
        bt_identity_addr(uid, (uint8_t)m, (uint16_t)r, a);
        CHECK((a[0] & 0xC0) == 0xC0);
        for (int k = 0; k < n; k++) if (memcmp(seen[k], a, 6) == 0) { CHECK(!"duplicate address"); break; }
        memcpy(seen[n++], a, 6);
    }
    bt_identity_addr(uid, 3, 5, a); bt_identity_addr(uid, 3, 6, b);
    CHECK(memcmp(a, b, 6) != 0);
    // counter: missing / wrong-sized storage starts at 1, otherwise +1, wraps
    uint8_t s2[2] = {0x34, 0x12};
    CHECK(bt_next_rot(-1, 0) == 1);
    CHECK(bt_next_rot(0, 0) == 1);
    CHECK(bt_next_rot(2, s2) == 0x1235);
    s2[0] = s2[1] = 0xFF; CHECK(bt_next_rot(2, s2) == 0);
    if (fails) return 1;
    puts("bt_addr_test OK");
    return 0;
}
