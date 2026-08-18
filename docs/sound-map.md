# 사운드 매핑 대조표

원본 Escape From Tarkov 설치본(`E:\Program Files\EFT`)의 어떤 오디오가 이 게임의
어떤 큐를 받치고, 그 큐가 어느 코드 줄에서 울리는지를 전부 대조한 표다.

**파일명 추측이 아니다.** 세 지점에서 확정했다.

1. **클립 이름은 유니티 에셋 이름이다.** `tools/extract_tarkov_sfx.py`의 인덱서는
   UnityPy로 번들을 열어 `AudioClip` 오브젝트의 `m_Name` 필드를 읽는다
   (`extract_tarkov_sfx.py:97-114`). 디스크의 파일명이 아니라 BSG가 에셋에 붙인
   내부 식별자다. 인덱스에 32,815개가 들어 있다.
2. **`sfx_picks.py`가 참조하는 클립 302건 전부가 그 인덱스에 존재한다.** 미해결 0건,
   매니페스트 누락 0건, 매니페스트에만 있고 픽에 없는 큐 0건, 고아 ogg 0건.
3. **아이템 효과음은 BSG의 `ItemSound` 필드를 그대로 쓴다.** `build_items.py:300-301`이
   SPT 3.10.1 `items.json`의 `_props.ItemSound`를 `snd`로 복사하고, 게임은
   `item_<snd>_<action>` 이름의 큐를 요청한다. 그 이름이 `itemsounds.bundle` 안의
   실제 클립 이름과 일치한다 — **원본 게임이 쓰는 식별자로 원본 클립을 부른다.**

현재 **170개 큐 / 347개 파일**. `tools/sfx_test.html` 55개 검사 전부 통과,
`tools/smoke.html` 125개 통과.

---

## 파이프라인

```
EFT 설치본                     추출/가공                  런타임
─────────────────────────      ───────────────────        ─────────────────────
sounds.bundle          ┐                                  manifest[cue] = [파일]
itemsounds.bundle      │   --index  AudioClip.m_Name              │
resources.assets       ├─► --search 이름 검색        ─────► play(cue) ─► 3버스
<무기>.bundle 11종      │   sfx_picks.py  큐 ← 클립               (sfx/ui/ambient)
sharedassets8/397/537  ┘   --extract ffmpeg 트림/믹스/모노/ogg
                            pack_sfx.py  deflate + AES-256-GCM
```

추출 공정(`extract_tarkov_sfx.py:184-224`)은 모든 클립에 동일하게 적용된다 —
모노 다운믹스, 앞뒤 -50dB 무음 제거, 32kHz(앰비언스만 22.05kHz), libvorbis q2.

`pack.bin`은 `SFX_PACK_KEY` 환경변수로 봉인한다. **키를 주지 않으면 새 패스프레이즈를
만들어 버려서 `audio.js`의 `SEALED_KEY`와 어긋난다.** 재패킹은 반드시:

```bash
SFX_PACK_KEY='aAzve0EY1zPMn9Z28Z-1rzq3hX_bh36z' python tools/pack_sfx.py
```

---

## 컨테이너별 출처

| EFT 컨테이너 | 담당 |
|---|---|
| `itemsounds.bundle` | 아이템 폴리 90큐 + 루팅 루프 10종 |
| `sharedassets397.assets` | 탄착·도탄 7큐 |
| `sounds.bundle` | 발소리 16큐 = 재질 4 × 보행 4 (102클립) |
| `resources.assets` | 인터페이스·거래 16큐 |
| `sharedassets8.assets` | 가구 뚜껑 8큐 |
| 무기 뱅크 11종 | 총성 22큐 |
| 무기 뱅크 8종 + `resources.assets` | 무기 조작 30큐 (탄창 탈착·노리쇠·개머리판 접기·장전 압입·모딩 화면) |
| `sharedassets537.assets` | Factory 앰비언스 |

---

## 이동 — `sounds.bundle`

**재질축과 보행축은 서로 독립이다.** 예전엔 아니었다 — `step_sprint`만
`sprint_metal`을 써서, 콘크리트 바닥에서 뛰기 시작하면 발밑 재질이 철골로 바뀌었다.
큐 이름은 `step_<재질>_<보행>`이고 재질 4종 × 보행 4단계 = 16큐다.

| 재질 | walk | run | sprint | stop | 쓰는 구역 |
|---|---|---|---|---|---|
| `concrete` | `walk_concrete1–6` | `run_concrete1–6` | *asphalt 대체* | *asphalt 대체* | 공장 내부 전반, 구역 밖 기본값 |
| `metal` | `walk_metal1–6` | `run_metal1–6` | `sprint_metal1–6` | `stop_metal1–3` | 사일로 피트, 1번 게이트 적재장 |
| `tile` | `walk_tile_01–06` | `run_tile_01–06` | `sprint_tile_01–06` | `stop_tile_01–03` | 사무동, 서편 정비실 |
| `asphalt` | `walk_asphalt_01–06` | `run_asphalt_01–06` | `sprint_asphalt_01–06` | `stop_asphalt_01–03` | 동편 야드, 서편 안뜰 |

> **설치본에 `sprint_concrete`와 `stop_concrete`가 아예 없다.** 콘크리트는 walk·run·
> turn·jump만 있다. 그래서 그 두 칸만 asphalt로 메웠다 — 둘 다 단단한 무기질 표면이라
> 예전에 쓰던 철골 그레이팅보다 훨씬 작은 거짓말이다. 나머지 재질은 전부 자기 것을 쓴다.

**클립 명명이 재질마다 다르다.** `concrete`와 두꺼운 `metal`은 한 자리 숫자를 그냥
붙이고(`walk_concrete1`), 나머지는 언더스코어 뒤에 0을 채운다(`walk_asphalt_01`).
유추하지 말고 `--search`로 확인할 것.

폴백은 **재질축으로만** 한다(`audio.js`). 없는 세트가 있으면 재질이 콘크리트로 바뀔
뿐, 스프린트가 걷기로 떨어지지는 않는다.

| 보행 | 최소 간격 | 게인 | 피치 랜덤 | 조건 |
|---|---|---|---|---|
| walk | 430ms | 0.50 | 0.94–1.07 | 장비 총중량 **35kg 초과** |
| run | 330ms | 0.55 | 0.97–1.09 | 35kg 이하 — **기본 보행이 조깅** |
| sprint | 265ms | 0.62 | 1.00–1.12 | 스프린트 중 |

`gear_stereo`는 원본에서 이동하는 플레이어의 장비가 흔들리는 소리다. 게임이 발자국
위에 겹쳐 재생하는 레이어를 추출 단계에서 미리 믹스해 굽는다. `stop`만 예외로 맨
클립이다.

### 재질 판정

`maps.js`의 각 구역에 `surface`가 붙어 있고 `raid.surfaceAt(x, y)`가 읽는다.
구역 사각형은 일부러 겹친다 — 사일로 피트가 처리동 안에 들어 있다 — 그래서
**해당 좌표를 덮는 가장 작은 사각형이 이긴다.** 어느 구역에도 안 들어가는 복도·틈은
콘크리트다.

> 스폰 지점 이름과 실제 재질이 어긋나는 곳이 셋 있다 — "West service rooms"(14, 62)는
> 서편 안뜰 사각형에 1유닛 걸쳐 asphalt, "East wall room"은 동편 야드라 asphalt,
> "East main hall"은 사무동 사각형 안이라 tile이 난다. 판정은 사각형대로 정확히
> 동작하는 것이고, 구역 사각형이 대략적이라 생기는 일이다.

> `step_<재질>_stop`은 실제로는 "빈 바닥을 클릭해 목적지에 도착" 한 경우에만 들린다.
> 컨테이너 앞 도착은 같은 프레임에 오버레이가 열려 `!overlayOpen` 가드에 막힌다.

---

## 컨테이너 수색 — `itemsounds.bundle`

원본의 루팅 루프 10종을 전부 쓴다. 컨테이너 23종이 **빠짐없이** 매핑되며 폴백으로
떨어지는 타입은 없다.

| 큐 | 원본 클립 | 원본 → trim | 컨테이너 |
|---|---|---|---|
| `search_wood` | `woodbox_looting` | 8.28s → 5.5s | crate, ammobox, weaponbox, weaponbox6, grenadebox, rationcrate |
| `search_industrial` | `industrialbox_looting` | 10.45s → 6.0s | toolbox, suitcase, medcase, medcrate |
| `search_techno` | `techno_box_looting_01` | 14.40s → 6.0s | pcblock, techcrate |
| `search_bag` | `sportbag_looting` | 10.57s → 5.0s | sportbag, duffle, medbag |
| `search_jacket` | `jacket_looting` | 13.15s → 4.0s | jacket |
| `search_safe` | `safe_looting` | 7.35s → 5.0s | safe, banksafe |
| `search_drawer` | `drawer_wood_looting` | 8.76s → 4.0s | drawer |
| `search_metal` | `drawer_metal_looting` | 10.85s → 5.0s | filecab |
| `search_cash` | `cashregister_looting` | 5.06s → 3.0s | cashreg |
| `search_body` | `looting_body_extended` | 9.95s → 5.5s | deadscav, pmcbody |

**이 큐들만 재생 방식이 다르다.** 단발이 아니라 루프 소스를 열어 둔다
(`audio.js:445-478`). 80ms 페이드인, 종료 시 120ms 페이드아웃. 아이템이 하나씩 나올
때마다 다시 울리지 않는다 — 원본도 그렇고, 4~6초 클립을 초당 재트리거하면 같은 소리가
네 겹으로 쌓인다. **아이템 발견 효과음은 의도적으로 없다** (원본에 없음).

### 뚜껑 여는 소리 — `sharedassets8.assets`

원래는 `itemsounds.bundle`의 `container_*_open` 4종을 썼다. 그건 **손에 든 아이템
케이스**가 내는 소리이고, 레이드에 놓인 가구는 자기 소리를 따로 갖고 있다. 이제
그쪽을 쓰므로 수색 루프와 재질이 맞는다 — 코트처럼 뒤적이는 것은 코트처럼 열린다.

| 큐 | 원본 클립 | 길이 | 컨테이너 |
|---|---|---|---|
| `open_wood` | `woodbox_open`, `woodbox_small_open` | 0.70 / 0.49s | crate, ammobox, weaponbox, weaponbox6, grenadebox, rationcrate |
| `open_case` | `plasticcase_heavy_open` | 0.49s | toolbox, suitcase, medcase, medcrate, pcblock, techcrate |
| `open_metal` | `safe_open` | 0.81s | safe, banksafe |
| `open_drawer` | `drawer_metal_open`, `drawer_metal_squeek_1` | 0.44s | drawer |
| `open_locker` | `door_metallocker_open` | 0.76s | filecab |
| `open_jacket` | `jacket_open` | 0.87s | jacket |
| `open_bag` | `sportbag_open` | 1.41s | sportbag, duffle, medbag |
| `open_cash` | `cashregister_open` | 1.50s | cashreg |

**시체는 뚜껑 소리가 없다.** `deadscav`/`pmcbody`는 `OPEN_CUE`에 일부러 넣지 않았고
`sfx.openContainer()`는 테이블에 없는 타입이면 그냥 return한다. 이전 빌드는 시신을
열 때 플라스틱 케이스 뚜껑 소리를 냈다.

`raid.js:289`의 호출은 `if (container.searched) return`보다 **앞**이라, 이미 다 턴
컨테이너를 다시 열어도 뚜껑 소리는 난다.

---

## 총성 — 무기별 뱅크 11종

**무기 12정이 각자 자기 녹음을 쓴다.** 이전에는 `fire_pistol`/`rifle`/`shotgun`/`smg`
4종을 구경으로 갈라 썼다.

설치본은 녹음 시기에 따라 총성 이름을 **세 가지 방식**으로 짓고, 어느 것도 무기
이름에서 유추할 수 없다:

```
ak74_indoor_close_01      신형 뱅크, 번호 변형 8개
akm_close_indoor_01       같은 시기인데 close/indoor 순서가 반대
tt_fire_indoor_close      구형 뱅크, 변형 1~2개, 이름에 "fire"가 들어감
```

전부 실내(`indoor`) 변형이다. Factory가 지붕 덮인 공장이라 반사가 맞는다.

| 큐 | 원본 클립 | 변형 | 번들 | 무기 |
|---|---|---|---|---|
| `fire_ak74` | `ak74_indoor_close_01`–`08` | 8 | `ak74.bundle` | AK-74N |
| `fire_aksu` | `aksu_indoor_close_01`–`08` | 8 | `aksu.bundle` | AKS-74U |
| `fire_akm` | `akm_close_indoor_01`–`08` | 8 | `akm.bundle` | AKM, VPO-136 |
| `fire_kedr` | `kedr_indoor_close_01`–`08` | 8 | `kedr.bundle` | PP-91 Kedr |
| `fire_kedrb` | `kedr_indoor_close_silenced_01`–`08` | 8 | `kedr.bundle` | PP-91-01 Kedr-B (**소음형**) |
| `fire_pm` | `pm_indoor_close1`–`2` | 2 | `pm.bundle` | Makarov PM |
| `fire_pb` | `pb_silenced_indoor_close1` | 1 | `pb.bundle` | PB (**소음형**) |
| `fire_tt` | `tt_fire_indoor_close`, `2` | 2 | `tt.bundle` | TT-33 |
| `fire_mp133` | `mr133_fire_indoor_close` | 1 | `mr133.bundle` | MP-133 |
| `fire_mp153` | `mr153_fire_indoor_close` | 1 | `mr153.bundle` | MP-153 |
| `fire_saiga` | `saiga_indoor_close1` | 1 | `saiga12.bundle` | Saiga-12K |

VPO-136만 자기 뱅크가 없다. AKM 계열 7.62x39 카빈이라 AKM 뱅크를 쓰는 **유일한
의도적 재사용**이다.

Kedr-B와 PB는 소음형이라 원본의 `_silenced` 뱅크를 쓴다 — 게임 안에서도 조용하다.

### 적의 사격 — `fire_<뱅크>_far`

**이전에는 적이 쏴도 아무 소리가 나지 않았다.** `ai.js`가 `sfx`를 import조차 하지
않았고 `registerShot`은 예광탄 기록만 남겼다.

이제 같은 뱅크의 `_distant` 변형을 −7dB로 재생한다(`ai.js:shoot`). 스캐브는 스폰 시
티어별 후보에서 뱅크를 하나 뽑아 두므로 같은 개체는 계속 같은 총을 쓴다:

> Saiga만 `_indoor_distant`가 없다. 예전엔 `saiga_outdoor_distant1`을 썼는데, 설치본에
> 유일한 실내 원거리 녹음인 **`saiga_indoor_far1`**(2.54s)로 바꿔 나머지 뱅크의 실내
> 정책과 맞췄다(2026-08-18).

| 티어 | 후보 |
|---|---|
| 1 | mp133, akm, kedr |
| 2 | akm, aksu, kedr, mp153 |
| 3+ | ak74, aksu, akm, saiga |

---

## 탄착 — `sharedassets397.assets`

명중 판정을 소리로 갈랐다. 이전에는 총성 외에 아무 피드백도 없었다.

| 큐 | 원본 클립 | 변형 | 언제 |
|---|---|---|---|
| `hit_body` | `body1`–`6` | 6 | 살에 맞음 |
| `hit_armor` | `bodyarmor1`–`4_close` | 4 | 방탄복이 막음 |
| `hit_helmet` | `impact_helmet_ric_3p_1`–`4` | 4 | 헬멧이 튕겨냄 |
| `impact_metal` | `metal1`–`6` | 6 | 빗나가 금속에 |
| `impact_wood` | `wood1`–`5` | 5 | 빗나가 나무에 |
| `impact_concrete` | `generic_hard1`–`3` | 3 | 빗나가 콘크리트에 |
| `ricochet` | `ricochet1`–`13` | 12 | 도탄 (`ricochet8`은 원본에 없음) |

`damagePlayer()`가 방탄복 흡수·헬멧 도탄 분기에서 무엇이 막았는지 기록해
해당 큐를 낸다. 플레이어는 막힌 탄과 관통을 소리로 구분할 수 있다.

---

## 아이템 취급 — `itemsounds.bundle`

큐 이름을 런타임에 조립한다: `item_<snd>_<pickup|drop|use>`.

**클래스 목록을 하드코딩하지 않고 `items-db.json`에서 파생한다.** 이전 픽 파일은
48개 클래스와 전체 `_use` 세트를 갖고 있었는데, 아이템이 실제로 쓰는 건 40종이고
`_use`는 10종만 발동 가능했다 — **팩에 실려 나가지만 절대 재생될 수 없는 큐가
57개** 있었다. 이제 pickup 40 + drop 40 + use 10 + generic 폴백 3 = 90큐다.

`_use`는 `raid-ui.js`의 USE 메뉴 조건(`tpl.res` && cat이 meds/food/drink)을 그대로
반영한다. 원본 번들에 `_use` 클립이 없는 5종(grenade, item_money, jewelry,
smallmetal, spec_multitool)은 `_NO_USE`로 제외되고 `_pickup`으로 대체된다.

아이템을 추가하고 `--extract`를 다시 돌리면 그 소리가 자동으로 들어온다. 팩이
데이터베이스와 어긋날 수 없다.

---

## 인터페이스 · 거래 · 결과 — `resources.assets`

| 큐 | 원본 클립 | 버스/게인 | 트리거 |
|---|---|---|---|
| `ui_click` | `button_click` | ui 0.45 | `.btn`/`.seg`/`.map-card` 클릭, 은신처 탭, 컨텍스트 메뉴 항목, 드래그 중 회전 |
| `ui_hover` | `button_over` | ui 0.22, 60ms | 위 요소 진입 |
| `ui_context` | `menu_context_menu` | ui 0.40 | 우클릭 메뉴가 실제로 뜰 때 |
| `ui_error` | `error_message` | ui 0.50, 400ms | `toast()`가 `warn`/`bad`일 때 + 거래 거부 6곳 |
| `ui_close` | `menu_escape` | ui 0.35 | 컨테이너 창 X, 레이드 오버레이 닫힘 |
| `ui_window_open` | `menu_open_container` | ui 0.45 | 레이드 오버레이 열림 |
| `ui_inspect_open` | `menu_inspector_window_open` | ui 0.40 | 모달 열림 전부 |
| `ui_inspect_close` | `menu_inspector_window_close` | ui 0.40 | 모달 닫힘 전부 |
| `ui_equip` | `clothes_equip` | **sfx** 0.55 | 드래그로 장비 착용 성공 |
| `ui_exp` | `notification_exp` | ui 0.40, 900ms | 레벨이 실제로 오름 |
| `trade_tab` | `menu_trader_press` | ui 0.45 | 다른 상인으로 전환 |
| `trade_click` | `trade_click_button` | ui 0.45 | 오퍼 스테이징, 세그먼트 전환, CLEAR, 수량 조작 |
| `trade_buy` | `buy_button_click` | ui 0.50 | Fill items |
| `trade_deal` | `trade_operation_complete` | ui 0.60 | 구매 커밋 성공, 판매 DEAL! 진입 |
| `extract_done` | `quest_completed` | ui 0.65 | 탈출 6초 홀드 완주 |
| `death` | `fp_death_heartbeat` | sfx 0.70 | `finish(KIA)` — MIA/LEFT는 무음 |
| `amb_factory` | `amb_factory_rework_day_loop` | ambient | 레이드 진입 2.5s 페이드인 / 종료 0.8s 페이드아웃 |

`ui_equip`만 ui 버스가 아니라 sfx 버스다 — 인터페이스 소리가 아니라 착용 폴리로
취급한다. 탈출음은 원본의 탈출 큐가 아니라 **퀘스트 완료음**이다.

---

## 남은 문제

- **거래 화면 일부 버튼은 소리가 두 번 난다.** `shell.js:76`의 문서 전역 클릭
  핸들러가 `.btn`/`.seg`를 잡는데, 자기 큐를 내는 컨트롤 중 `data-sfx`가 붙은 건
  DEAL! 버튼 둘뿐이다. BUY/SELL 세그먼트와 Fill items 버튼은 `ui_click`과
  `trade_*`가 겹친다. **`trade.js`가 현재 편집 중이라 손대지 않았다** — 해당
  요소에 `dataset: { sfx: 'own' }`을 붙이면 해결된다.
- **총성·탄착·사망음은 아직 들을 수 없다.** `raid.js:94`의 `spawnScavs(count = 0)`이
  적을 만들지 않아서다(의도된 설정). `count`를 7로 되돌리면 전부 살아난다 — 배선은
  끝나 있고 `sfx_test.html`이 실제 입력으로 호출해 검증한다.
- `ui_error`의 400ms 리밋이 이중 호출을 가린다. `trade.js`가 직접 부르고 `toast()`가
  또 불러도 한 번만 들린다.
- `ui_inspect_open`/`_close`는 아이템 검사 전용이 아니다. 모달 전체가 공유한다.
- Alt+클릭 퀵 장착은 무음이다. 드래그 착용만 `ui_equip`을 낸다.

---

## 재현

```bash
python tools/extract_tarkov_sfx.py --index      # 32,815 클립 카탈로그
python tools/extract_tarkov_sfx.py --search ak74  # 이름으로 검색
python tools/extract_tarkov_sfx.py --extract    # assets/sfx-eft/*.ogg
SFX_PACK_KEY='aAzve0EY1zPMn9Z28Z-1rzq3hX_bh36z' python tools/pack_sfx.py
```

인덱스(`tools/cache/`)와 추출본(`assets/sfx-eft/`)은 둘 다 gitignore다. 저장소가
추적하는 건 봉인된 `pack.bin`뿐이다. 원본 오디오는 Battlestate Games의 저작물이며,
소유한 사본에서 로컬로 쓰는 것과 재배포는 다른 문제다.


---

## 무기 조작 — 조립·탄창·장전 (2026-08-18 추가)

총기 파츠·탄창·탄약 시스템이 들어오면서 발사 이외의 무기 소리를 같은 설치본에서
뽑았다. 조작음은 총성보다 무기별 커버리지가 좁아서 **빌려 쓰는 관계를 명시**해 두었다
(`audio.js`의 `HANDLING`, `sfx_picks.py`의 `_HANDLING`이 같은 표다).

| 뱅크 | magin / magout | bolt | fold open / close | 출처 |
|---|---|---|---|---|
| `ak74` | `ak74_magin_plastic` / `ak74_magout_plastic` | `ak74_slider_up`, `ak74_slider_down` | — | `weapons/ak74.bundle` |
| `aksu` | AK-74의 것 | AK-74의 것 | `aksu_stock_open` / `aksu_stock_close` | `weapons/aksu.bundle` |
| `akm` | `akm_magin_metal` / `akm_magout_metal` | `akms_slider_up`, `akms_slider_down` (ak74.bundle 안) | `akms_stock_unfold` / `akms_stock_fold` | `weapons/akm/instrumental.bundle` |
| `kedr` | `kedr_magin` / `kedr_magout` | `kedr_slider_up`, `kedr_slider_down` | `9A91_stock_unfold` / `9A91_stock_fold` (**빌림** — 같은 상부 접이식인 9A-91의 것, ak74.bundle 안. kedr.bundle에는 개머리판 클립이 없다) | `weapons/kedr.bundle` |
| `pm` (PB·TT도 사용) | `pm_mag_in` / `pm_mag_out` | `pm_slider_out`, `pm_slider_in` | — | `weapons/pm.bundle` |
| `mp133` | `mr133_shell_in_mag` / `mr133_shell_out_mag` | `mr133_pump_out`, `mr133_pump_in` | — | `weapons/mr133.bundle` |
| `mp153` | MP-133의 셸 | `mr153_slider_up`, `mr153_slider_down` | — | `weapons/mr153.bundle` |
| `saiga` | `saiga_magin_plastic` / `saiga_magout_plastic` | `saiga_slider_up`, `saiga_slider_down` | `saiga_stock_open` / `saiga_stock_close` | `weapons/saiga12.bundle` |

TT와 PB는 설치본에 조작음이 아예 없다(총성만 있다) — Makarov의 것을 쓴다.

> **접이식 개머리판 큐는 2026-08-18까지 한 번도 울린 적이 없었다.** 픽은 `fold_open_<뱅크>` /
> `fold_close_<뱅크>`로 굽는데 `audio.js`의 `weaponFold`는 `fold_<뱅크>_open`을 불렀다.
> `play()`가 모르는 큐를 조용히 무시하니 아무도 눈치채지 못했다. `audio.js` 쪽을 팩
> 이름에 맞춰 고쳤고(`fold_${open|close}_${뱅크}`), `sfx_test.html`이 이제 items-db의
> `wpn.fold`가 붙은 총마다 fold 쌍이 팩에 있는지 검사한다.

| 큐 | 원본 클립 | 언제 |
|---|---|---|
| `modding_open` / `modding_close` | `menu_modding_open` / `menu_modding_close` | 모딩 창 열고 닫을 때 |
| `mod_install_vital` / `_func` / `_gear` | `menu_install_mod_vital` / `_func` / `_gear` | 파츠 장착 — 필수 파츠 / 조준기·전술장비 / 나머지 (게임의 세 갈래 그대로) |
| `mod_install_mag` | `menu_install_mag` | (예비) |
| `ammo_load` / `ammo_unload` | `ammo_load1–7` / `ammo_unload1–7` | 탄창에 탄 넣고 뺄 때, 최대 4회 압입을 110ms 간격으로 |
| `shell_load` / `shell_unload` | `mr133_shell_in_mag(1–3)` / `mr133_shell_out_mag` | 12게이지 탄창(튜브)일 때 위 대신 |
| 탄창 장착·분리 | 위 표의 `magin_<뱅크>` / `magout_<뱅크>` | 모딩 창이나 드래그로 탄창을 끼우고 뺄 때 — 무기 뱅크로 고른다 |
| 파츠 분리 | 파츠 자체의 `item_mod_pickup` | 탄창 이외의 파츠를 뺄 때 |

`mod_pickup/drop`, `mag_plastic_*`, `magazine_metal_*`은 새 아이템들의 `ItemSound`에서
**파생**되어 자동으로 팩에 들어왔다(`_item_cues`) — 하드코딩한 게 아니다.

현재 **210개 큐 / 409개 파일**, `pack.bin` 2.8 MiB. `tools/smoke.html` 191개 통과.

---

## 무기 동작 · 소음기 · 정비 (2026-08-18 추가, 2차)

발사 이외의 방아쇠·조정간·점검·급탄·고장 큐와 소음기 장착 총성, 정비/조립/탄약 개봉
효과음을 같은 설치본에서 뽑았다. 조작 뱅크 8종(`ak74 aksu akm kedr pm mp133 mp153
saiga`)마다 `<종류>_<뱅크>` 이름으로 들어 있고, `audio.js`의 `HANDLING`이 총성 뱅크를
조작 뱅크로 접는다(kedrb→kedr, pb·tt→pm). 픽 표는 `sfx_picks.py`의 `_ACTIONS`.

### 동작 큐 — 뱅크별 원본 클립

**빌림**은 굵게. 설치본의 커버리지가 총성보다 훨씬 좁아 표의 절반이 빌림이다.

| 뱅크 | `dry_` 공이치기(빈 약실) | `selector_` 조정간 | `magcheck_` 탄창 확인 | `chambercheck_` 약실 확인 | `chamber_` / `unchamber_` 약실에 손으로 넣기/빼기 | `jam_` 고장 |
|---|---|---|---|---|---|---|
| `ak74` | `ak74_trigger_empty` | `ak74_fireselector_up`, `_down` | `ak74_magout_plastic` | **`saiga_slider_check`** | `ak74_round_in_chamber` / `ak74_round_out` | `ak74_slider_jam` |
| `aksu` | **`ak74_trigger_empty`** | **`ak74_fireselector_*`** | **`ak74_magout_plastic`** | **`saiga_slider_check`** | **`ak74_round_in_chamber` / `ak74_round_out`** | **`ak74_slider_jam`** |
| `akm` | **`ak74_trigger_empty`** | **`ak74_fireselector_*`** | `akm_magout_metal` | **`saiga_slider_check`** | **`ak74_round_in_chamber` / `ak74_round_out`** | **`ak74_slider_jam`** |
| `kedr` | `kedr_trigger_empty` | `kedr_fireselector_up`, `_down` | `kedr_magout` | `kedr_slider_up_slow`, `kedr_slider_down_slow` | `kedr_round_in_chamber` / `kedr_round_out` | `kedr_slider_jam` |
| `pm` (PB·TT) | `pm_trigger_empty` | — (단발) | `pm_mag_pullout` (1.6s라 trim 1.8) | `pm_catch_slider` | `pm_slider_in` / `pm_slider_out` (탄 클립이 없어 슬라이드로 대신) | `pm_slider_jammed`, `pm_shell_jammed` |
| `mp133` | `mr133_trigger` | — | `mr133_magcover` (튜브 마개) | `mr133_pump_out` (펌프 반만) | `mr133_shell_in_port` / `mr133_shell_pickup` | **`saiga_slider_jam`** |
| `mp153` | **`mr133_trigger`** | — | **`mr133_magcover`** | **`mr133_pump_out`** | **`mr133_shell_in_port` / `mr133_shell_pickup`** | **`saiga_slider_jam`** |
| `saiga` | `saiga_trigger_empty` | — | `saiga_magout_plastic` | `saiga_slider_check` | `saiga_round_in_chamber` / `saiga_round_out` | `saiga_slider_jam` |

- `saiga_slider_check`는 12개 뱅크를 통틀어 유일한 `_check` 슬라이드라 AK 셋이 빌린다.
- `ak74_trigger_empty`는 유일한 AK 공이치기 클릭이고, `mr133_trigger`는 두 산탄총 번들을
  통틀어 유일한 방아쇠 클립이다.
- `magcheck_pm`은 원래 `pm_mag_pullout` + `pm_mag_pullin` 두 단계인데 추출기가 레이어를
  **믹스**하지 이어붙이지는 않아서 pullout만 넣었다.
- 조정간 큐는 items-db `wpn.fire`에 `fullauto`가 있는 총(AK-74N·AKM·AKS-74U·Kedr·Kedr-B)만.
  VPO-136·권총·산탄총은 단발이라 큐가 없고 `sfx.fireSelector()`는 조용히 아무것도 안 한다.
- 별도로 `jam_examined` = `battle_malfunction_examined`(resources.assets) — 고장을 살펴본
  순간의 원본 스팅.

모든 동작 큐는 조작 큐와 같은 trim [0, 1.2] / gain −4dB. `audio.js` 메서드:
`weaponDry(tpl)` `fireSelector(tpl)` `magCheck(tpl)` `chamberCheck(tpl)`
`chamberRound(tpl, loaded=true)` `weaponJam(tpl)`.

> `dry_ak74`·`dry_saiga`는 결과 파일이 24ms다. 원본 `*_trigger_empty`(0.18s)는 클릭 두 번
> 사이에 −50dB 아래 구간이 있는데, 추출기의 뒤쪽 무음 제거(`silenceremove`, RMS 창 검출)가
> 두 번째 클릭까지 잘라낸다. 다른 짧은 클립(`ui_click` 0.07s)도 같은 공정을 거친 것이라
> 관행대로 두었다. 살리려면 `extract_tarkov_sfx.py:transcode`의 두 `silenceremove`에
> `detection=peak`를 붙이면 되는데(0.157s로 살아남는 걸 확인), 팩 전체의 꼬리 길이가
> 함께 바뀌므로 이 문서 범위에서는 손대지 않았다.

### 소음기 총성 — `fire_<뱅크>_sil` / `_sil_far`

`sfx.fire(tpl, { suppressed: true })` / `sfx.hostileFire(tpl, { suppressed: true })`가
해당 큐가 팩에 있을 때만 골라 쓴다. 없으면(PM은 소음기를 못 달고, Kedr는 소음형이
`fire_kedrb`라는 별개 뱅크) 맨 총성이 그대로 난다. **플래그를 넘기지 않으면 예전과 완전히
같다.** trim/gain은 `WEAPON_FIRE`와 동일(근접 [0,1.6] −3dB / 원거리 [0,1.8] −7dB).

설치본이 "silenced"를 이름에 넣는 자리가 세 가지고 AK-74는 근접·원거리끼리도 다르다:

| 큐 | 원본 클립 (근접 / 원거리) | 변형 | 번들 |
|---|---|---|---|
| `fire_ak74_sil` / `_sil_far` | `ak74_indoor_silenced_close_01–08` / `ak74_indoor_distant_silenced_01–08` | 8+8 | `ak74.bundle` |
| `fire_aksu_sil` / `_sil_far` | `aksu_indoor_close_silenced_01–08` / `aksu_indoor_distant_silenced_01–08` | 8+8 | `aksu.bundle` |
| `fire_akm_sil` / `_sil_far` | `akm_close_indoor_silenced_01–08` / `akm_distant_indoor_silenced_01–08` | 8+8 | `akm.bundle` |
| `fire_mp133_sil` / `_sil_far` | `mr133_fire_silenced_indoor_close` / `_distant` | 1+1 | `mr133.bundle` |
| `fire_mp153_sil` / `_sil_far` | `mr153_fire_silenced_indoor_close` / `_distant` | 1+1 | `mr153.bundle` |
| `fire_saiga_sil` / `_sil_far` | `saiga_fire_silenced_indoor_close` / `_distant` | 1+1 | `saiga12.bundle` |
| `fire_tt_sil` / `_sil_far` | **`pb_silenced_indoor_close1` / `pb_silenced_indoor_distant1`** (빌림 — `tt_*silenced*`가 없다) | 1+1 | `pb.bundle` |
| `fire_pb_unsil` / `_unsil_far` | `pb_indoor_close1` / `pb_indoor_distant1` — PB는 기본 녹음이 소음형이라 **소음기를 뗀** 쪽이 별도 큐 | 1+1 | `pb.bundle` |

`sfx.fire(tpl, { suppressed: false })`는 PB에서만 의미가 있고 `fire_pb_unsil`을 고른다.

### 정비 · 조립 · 탄약 개봉

| 큐 | 원본 클립 | 컨테이너 | `audio.js` |
|---|---|---|---|
| `repair_done` | `repair_complete` | resources.assets | `sfx.repairDone()` (ui 0.5) |
| `repair_kit_use` | `spec_weaprep_use` | itemsounds.bundle | `sfx.repairKit()` |
| `build_assemble` | `menu_weapon_assemble` | resources.assets | `sfx.buildAssemble()` (ui 0.5) |
| `build_strip` | `menu_weapon_disassemble` | resources.assets | `sfx.buildStrip()` (ui 0.5) |
| `ammo_unpack` | `ammo_pack_generic_use` | itemsounds.bundle | `sfx.ammoUnpack(tpl)` — 12게이지 외 전부 |
| `ammo_unpack_12ga` | `ammo_shotgun_use` | itemsounds.bundle | `sfx.ammoUnpack(tpl)` — `tpl.cal`이 `12`로 시작할 때 |
| `item_spec_weaprep_pickup` / `_drop` | `spec_weaprep_pickup` / `_drop` | itemsounds.bundle | `sfx.item(tpl, …)` — 무기 수리 키트의 ItemSound. `_item_cues()`가 만들 이름 그대로 명시해 두어 DB에 키트가 있으면 같은 키에 겹쳐 쓰인다 |

`ammo_pack_generic`은 SPT 탄약 상자 202종의 ItemSound이고 `ammo_shotgun`은 12/70 RIP
5발 상자 하나뿐이다. pickup/drop은 `_item_cues()`가 DB에서 파생한다.

현재 **289개 큐 / 536개 파일**, `pack.bin` 3.19 MiB(3,343,882 B). `tools/sfx_test.html`
88개 검사 중 84개 통과 — 실패 4건은 전부 이전부터 있던 것(`ui_back` 큐 없음, `ui_error`
미사용, `looseloot` 컨테이너의 수색 루프·뚜껑 미매핑)이고 이 문서 범위 밖이다.
