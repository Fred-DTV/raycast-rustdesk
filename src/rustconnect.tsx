import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { connectRustDesk } from "./connectRustDesk";
import { Device, loadDevices, peersPathForDisplay } from "./loadPeers";

function platformIcon(platform?: string): Icon {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("win")) return Icon.Window;
  if (p.includes("mac") || p.includes("darwin")) return Icon.Finder;
  if (p.includes("linux")) return Icon.Terminal;
  return Icon.Desktop;
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const { data, isLoading, error, revalidate } = usePromise(loadDevices);

  const devices = data ?? [];

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) {
      return devices;
    }

    return devices.filter((device) => {
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
  }, [devices, searchText]);

  const rawId = searchText.trim();
  const showRawConnect =
    rawId.length > 0 && !filtered.some((device) => device.id.toLowerCase() === rawId.toLowerCase());

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
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
            </ActionPanel>
          }
        />
      ) : null}

      {!error &&
        filtered.map((device: Device) => (
          <List.Item
            key={device.id}
            title={device.name}
            subtitle={device.name === device.id ? device.platform : device.id}
            accessories={[
              ...(device.platform ? [{ text: device.platform }] : []),
              ...(device.username ? [{ text: device.username, icon: Icon.Person }] : []),
            ]}
            keywords={[
              device.id,
              device.hostname ?? "",
              device.username ?? "",
              device.platform ?? "",
              ...(device.keywords ?? []),
            ]}
            icon={platformIcon(device.platform)}
            actions={
              <ActionPanel>
                <Action title="Connect" icon={Icon.Link} onAction={() => connectRustDesk(device.id)} />
                <Action.CopyToClipboard title="Copy ID" content={device.id} />
                <Action title="Reload Peers" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
              </ActionPanel>
            }
          />
        ))}

      {!error && showRawConnect ? (
        <List.Item
          title={`Connect raw ID: ${rawId}`}
          subtitle="Not in peer list"
          icon={Icon.Terminal}
          actions={
            <ActionPanel>
              <Action title="Connect" icon={Icon.Link} onAction={() => connectRustDesk(rawId)} />
              <Action title="Reload Peers" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
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
              <Action title="Reload Peers" icon={Icon.ArrowClockwise} onAction={() => revalidate()} />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
