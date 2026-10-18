// BTstack configuration for YAGCC: BLE peripheral only (HID over GATT), on the CYW43 radio.
#ifndef YAGCC_BTSTACK_CONFIG_H
#define YAGCC_BTSTACK_CONFIG_H

#define ENABLE_LE_PERIPHERAL
#define ENABLE_LE_SECURE_CONNECTIONS   // stored-key pairing, what Windows / Android / iOS expect for HID
#define ENABLE_LOG_ERROR
#define ENABLE_PRINTF_HEXDUMP   // needed by the SDK's hci dump file (no output: stdio goes nowhere)

#define HCI_OUTGOING_PRE_BUFFER_SIZE 4
#define HCI_ACL_PAYLOAD_SIZE (255 + 4)
#define HCI_ACL_CHUNK_SIZE_ALIGNMENT 4
#define MAX_NR_GATT_CLIENTS 1
#define MAX_NR_HCI_CONNECTIONS 1
#define MAX_NR_L2CAP_CHANNELS 2
#define MAX_NR_L2CAP_SERVICES 2
#define MAX_NR_SM_LOOKUP_ENTRIES 3
#define MAX_NR_WHITELIST_ENTRIES 1
#define MAX_NR_LE_DEVICE_DB_ENTRIES 16

// avoid overrunning the CYW43 shared bus
#define MAX_NR_CONTROLLER_ACL_BUFFERS 3
#define MAX_NR_CONTROLLER_SCO_PACKETS 3
#define ENABLE_HCI_CONTROLLER_TO_HOST_FLOW_CONTROL
#define HCI_HOST_ACL_PACKET_LEN (255 + 4)
#define HCI_HOST_ACL_PACKET_NUM 3
#define HCI_HOST_SCO_PACKET_LEN 120
#define HCI_HOST_SCO_PACKET_NUM 3

// bonds live in flash (TLV), two sectors just below the YAGCC config sector (see CMakeLists.txt)
#define NVM_NUM_DEVICE_DB_ENTRIES 16

#define MAX_ATT_DB_SIZE 512
#define HAVE_EMBEDDED_TIME_MS
#define HAVE_ASSERT
#define HCI_RESET_RESEND_TIMEOUT_MS 1000
#define ENABLE_SOFTWARE_AES128
#define ENABLE_MICRO_ECC_FOR_LE_SECURE_CONNECTIONS

#endif
