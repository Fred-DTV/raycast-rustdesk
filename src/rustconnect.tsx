import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { connectRustDesk } from "./connectRustDesk";
import { Device, loadDevices, peersPathForDisplay } from "./loadPeers";
import { loadOnlineLookup, OnlineState, resolveOnlineState } from "./onlineStatus";

function platformIcon(platform?: string): Icon {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("win")) return Icon.Window;
  if (p.includes("mac") || p.includes("darwin")) return Icon.Finder;
  if (p.includes("linux")) return Icon.Terminal;
  return Icon.Desktop;
}

function onlineAccessory(state: OnlineState): List.Item.Accessory | undefined {
  if (state === "online") {
    return { tag: { value: "Online", color: Color.Green }, tooltip: "Online (Server Pro API)" };
  }
  if (state === "offline") {
    return { tag: { value: "Offline", color: Color.SecondaryText }, tooltip: "Offline (Server Pro API)" };
  }
  return undefined;
}

function onlineRank(state: OnlineState): number {
  if (state === "online") return 0;
  if (state === "offline") return 1;
  return 2;
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const {
    data: devicesData,
    isLoading: devicesLoading,
    error,
    revalidate: revalidateDevices,
  } = usePromise(loadDevices);
  const {
    data: onlineLookup,
    isLoading: onlineLoading,
    revalidate: revalidateOnline,
  } = usePromise(loadOnlineLookup);

  const devices = devicesData ?? [];
  const isLoading = devicesLoading || onlineLoading;

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = !q
      ? devices
      : devices.filter((device) => {
          const haystack = [
            device.name,
            device.id,
            device.hostname,
            device.username,
            device.platform,
            ...(device.keywords ?? []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        });

    // When online status is on, show online devices first
    if (onlineLookup?.enabled) {
      return [...list].sort((a, b) => {
        const ra = onlineRank(resolveOnlineState(a, onlineLookup));
        const rb = onlineRank(resolveOnlineState(b, onlineLookup));
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
    }

    return list;
  }, [devices, searchText, onlineLookup]);

  const rawId = searchText.trim();
  const showRawConnect =
    rawId.length > 0 && !filtered.some((device) => device.id.toLowerCase() === rawId.toLowerCase());

  function reloadAll() {
    revalidateDevices();
    revalidateOnline();
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search RustDesk peers or type an ID…"
      filtering={false}
      onSearchTextChange={setSearchText}
      throttle
    >
      {error ? (
        <List.EmptyView
          icon={Icon.Warning}
          title="Could not load peers"
          description={`${error instanceof Error ? error.message : String(error)}\nTried: ${peersPathForDisplay()}`}
          actions={
            <ActionPanel>
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={reloadAll} />
            </ActionPanel>
          }
        />
      ) : null}

      {!error && onlineLookup?.enabled && onlineLookup.error ? (
        <List.Item
          title="Online status unavailable"
          subtitle={onlineLookup.error}
          icon={{ source: Icon.Warning, tintColor: Color.Orange }}
          actions={
            <ActionPanel>
              <Action title="Retry Online Status" icon={Icon.ArrowClockwise} onAction={() => revalidateOnline()} />
              <Action title="Reload All" icon={Icon.ArrowClockwise} onAction={reloadAll} />
            </ActionPanel>
          }
        />
      ) : null}

      {!error &&
        filtered.map((device: Device) => {
          const online = resolveOnlineState(device, onlineLookup);
          const statusAcc = onlineAccessory(online);
          return (
            <List.Item
              key={device.name.toLowerCase()}
              title={device.name}
              accessories={[
                ...(statusAcc ? [statusAcc] : []),
                ...(device.platform ? [{ text: device.platform }] : []),
                ...(device.username ? [{ text: device.username, icon: Icon.Person }] : []),
              ]}
              keywords={[
                device.id,
                device.hostname ?? "",
                device.username ?? "",
                device.platform ?? "",
                online,
                ...(device.keywords ?? []),
              ]}
              icon={platformIcon(device.platform)}
              actions={
                <ActionPanel>
                  <Action title="Connect" icon={Icon.Link} onAction={() => connectRustDesk(device.id)} />
                  <Action.CopyToClipboard title="Copy ID" content={device.id} />
                  <Action title="Reload Peers" icon={Icon.ArrowClockwise} onAction={reloadAll} />
                </ActionPanel>
              }
            />
          );
        })}

      {!error && showRawConnect ? (
        <List.Item
          title={`Connect raw ID: ${rawId}`}
          subtitle="Not in peer list"
          icon={Icon.Terminal}
          actions={
            <ActionPanel>
              <Action title="Connect" icon={Icon.Link} onAction={() => connectRustDesk(rawId)} />
              <Action title="Reload Peers" icon={Icon.ArrowClockwise} onAction={reloadAll} />
            </ActionPanel>
          }
        />
      ) : null}

      {!error && !isLoading && filtered.length === 0 && !showRawConnect ? (
        <List.EmptyView
          title="No peers found"
          description={`RustDesk peers dir:\n${peersPathForDisplay()}\nOptional extras: assets/devices.json`}
          actions={
            <ActionPanel>
              <Action title="Reload Peers" icon={Icon.ArrowClockwise} onAction={reloadAll} />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
