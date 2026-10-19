cmake_minimum_required(VERSION 3.13)

# Custom board headers (pico_clone = generic RP2040 clones)
set(PICO_BOARD_HEADER_DIRS ${CMAKE_CURRENT_LIST_DIR}/boards)

# Usage:  cmake -B build -DPICO_BOARD=pico_w -DPICO_SDK_PATH=/path/to/pico-sdk
include(pico_sdk_import.cmake)

project(yacc C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

# USB host port for console authentication passthrough (Pico-PIO-USB 0.6.1, MIT, vendored)
set(PICO_PIO_USB_PATH ${CMAKE_CURRENT_LIST_DIR}/lib/pico_pio_usb)

pico_sdk_init()

set(YACC_VERSION_MAJOR 0)
set(YACC_VERSION_MINOR 15)

# Board ids reported to the web app
if(PICO_BOARD STREQUAL "pico")
  set(YACC_BOARD_ID 0)
elseif(PICO_BOARD STREQUAL "pico_w")
  set(YACC_BOARD_ID 1)
elseif(PICO_BOARD STREQUAL "pico2")
  set(YACC_BOARD_ID 2)
elseif(PICO_BOARD STREQUAL "pico2_w")
  set(YACC_BOARD_ID 3)
elseif(PICO_BOARD STREQUAL "pico_clone")
  set(YACC_BOARD_ID 4)
elseif(PICO_BOARD STREQUAL "waveshare_rp2040_zero")
  set(YACC_BOARD_ID 5)
elseif(PICO_BOARD STREQUAL "waveshare_rp2040_one")
  set(YACC_BOARD_ID 6)
elseif(PICO_BOARD STREQUAL "sparkfun_promicro")
  set(YACC_BOARD_ID 7)
elseif(PICO_BOARD STREQUAL "adafruit_kb2040")
  set(YACC_BOARD_ID 8)

else()
  set(YACC_BOARD_ID 255)
endif()

add_executable(yacc
  src/main.c
  src/usb_descriptors.c
  src/usb_drivers.c
  src/config.c
  src/input.c
  src/bt.c
  src/rgb.c
  # console authentication passthrough over a PIO USB host port (ported from GP2040-CE, MIT)
  src/host/usb_host.cpp
  src/host/ps4_auth.cpp
  src/host/xbone.cpp
  src/host/xgip_protocol.cpp
  src/host/xinput_host.cpp
  # libxsm3 (Xbox 360 security, LGPL-2.1, by InvoxiPlayGames - same copy Santroller ships)
  lib/xsm3/excrypt_des.c
  lib/xsm3/excrypt_parve.c
  lib/xsm3/excrypt_sha.c
  lib/xsm3/usbdsec.c
  lib/xsm3/xsm3.c
)

pico_generate_pio_header(yacc ${CMAKE_CURRENT_LIST_DIR}/src/ws2812.pio)

target_include_directories(yacc PRIVATE src lib/xsm3)

target_compile_definitions(yacc PRIVATE
  YACC_VERSION_MAJOR=${YACC_VERSION_MAJOR}
  YACC_VERSION_MINOR=${YACC_VERSION_MINOR}
  YACC_BOARD_ID=${YACC_BOARD_ID}
  # Core 1 never runs, so saving to flash only has to mask interrupts on core 0. Without this, linking
  # pico_multicore (pulled in by the USB host and radio libraries) makes flash_safe_execute() refuse to run.
  PICO_FLASH_ASSUME_CORE1_SAFE=1
)

target_link_libraries(yacc
  pico_stdlib
  pico_unique_id
  pico_flash
  hardware_gpio
  hardware_adc
  hardware_flash
  hardware_sync
  hardware_watchdog
  hardware_pio
  hardware_clocks
  tinyusb_device
  tinyusb_host
  tinyusb_pico_pio_usb
  pico_util
)

pico_add_extra_outputs(yacc)

# Wireless boards (CYW43 radio) get Bluetooth: a BLE HID gamepad (BTstack, HID over GATT)
if(PICO_BOARD STREQUAL "pico_w" OR PICO_BOARD STREQUAL "pico2_w")
  target_compile_definitions(yacc PRIVATE
    YACC_HAS_BT=1
    # bonds are kept in the two flash sectors just below the YAGCC config sector (the last one)
    PICO_FLASH_BANK_TOTAL_SIZE=8192
    PICO_FLASH_BANK_STORAGE_OFFSET=\(PICO_FLASH_SIZE_BYTES-12288\)
  )
  target_link_libraries(yacc pico_cyw43_arch_none pico_btstack_ble pico_btstack_cyw43 pico_rand)
  # test builds: -DYACC_BT_LOG_FLASH=ON keeps the Bluetooth event log in flash across power cycles
  option(YACC_BT_LOG_FLASH "Keep the Bluetooth event log in flash (test builds)" OFF)
  if(YACC_BT_LOG_FLASH)
    target_compile_definitions(yacc PRIVATE YACC_BT_LOG_FLASH=1)
  endif()
  pico_btstack_make_gatt_header(yacc PRIVATE ${CMAKE_CURRENT_LIST_DIR}/src/yagcc.gatt)
endif()

# ---- flash nuke -------------------------------------------------------------
add_subdirectory(nuke)
