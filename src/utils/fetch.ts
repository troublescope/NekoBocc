import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { headersConfig } from './config.js';

type ProxyType = 'http' | 'socks4' | 'socks5';

interface ProxyEntry {
    type: ProxyType;
    url: string;
    lastUsed?: number;
}

// Extend RequestInit to include agent
interface ExtendedRequestInit extends RequestInit {
    agent?: any;  // Using any here because Node's types aren't available in browser TypeScript
}

class ProxyHandler {
    private proxies: ProxyEntry[] = [];
    private currentIndex = 0;
    private lastUpdate = 0;
    private readonly updateInterval = 1800000; // 30 minutes
    private isUpdating = false;

    private async fetchProxyList(): Promise<string[]> {
        try {
            const response = await globalThis.fetch(
                'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/all.txt'
            );
            if (!response.ok) return [];
            const text = await response.text();
            return text.split('\n').filter(line => line.trim());
        } catch {
            return [];
        }
    }

    private parseProxyLine(line: string): ProxyEntry | null {
        line = line.trim();
        if (!line) return null;

        if (line.startsWith('socks5://')) {
            return { type: 'socks5', url: line };
        } else if (line.startsWith('socks4://')) {
            return { type: 'socks4', url: line };
        } else if (line.startsWith('http://') || line.startsWith('https://')) {
            return { type: 'http', url: line };
        }

        return { type: 'http', url: `http://${line}` };
    }

    async updateProxies(): Promise<void> {
        if (this.isUpdating || Date.now() - this.lastUpdate < this.updateInterval) {
            return;
        }

        this.isUpdating = true;
        try {
            const proxyLines = await this.fetchProxyList();
            const newProxies: ProxyEntry[] = [];

            for (const line of proxyLines) {
                const proxy = this.parseProxyLine(line);
                if (proxy) newProxies.push(proxy);
            }

            if (newProxies.length > 0) {
                this.proxies = newProxies;
                this.currentIndex = 0;
                this.lastUpdate = Date.now();
                console.log(`[${new Date().toISOString()}] Updated proxy list: ${this.proxies.length} proxies available`);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Failed to update proxies:`, error);
        } finally {
            this.isUpdating = false;
        }
    }

    async getNextProxy(): Promise<ProxyEntry | null> {
        if (this.proxies.length === 0 || Date.now() - this.lastUpdate > this.updateInterval) {
            await this.updateProxies();
        }

        if (this.proxies.length === 0) {
            return null;
        }

        const proxy = this.proxies[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        proxy.lastUsed = Date.now();
        return proxy;
    }

    getProxyAgent(proxy: ProxyEntry): HttpsProxyAgent<string> | SocksProxyAgent {
        if (proxy.type === 'socks4' || proxy.type === 'socks5') {
            return new SocksProxyAgent(proxy.url);
        }
        return new HttpsProxyAgent(proxy.url);
    }
}

const handler = new ProxyHandler();

export async function enhancedFetch(url: string, options: ExtendedRequestInit = {}): Promise<Response> {
    const defaultOptions: ExtendedRequestInit = {
        headers: {
            ...headersConfig.headers,
            'User-Agent': `NekoBocc/1.5.1 (by @troublescope) ${headersConfig.headers['User-Agent']}`
        }
    };

    const mergedOptions: ExtendedRequestInit = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };

    let retries = 3;
    while (retries > 0) {
        try {
            const proxy = await handler.getNextProxy();
            
            if (!proxy) {
                console.log(`[${new Date().toISOString()}] No proxy available, using direct connection`);
                return globalThis.fetch(url, mergedOptions);
            }

            const response = await globalThis.fetch(url, {
                ...mergedOptions,
                agent: handler.getProxyAgent(proxy)
            } as RequestInit);

            if (response.ok) {
                return response;
            }

            console.warn(`[${new Date().toISOString()}] Proxy request failed with status ${response.status}, retrying...`);
            retries--;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Proxy request error:`, error);
            retries--;
        }
    }

    console.log(`[${new Date().toISOString()}] All proxy attempts failed, using direct connection`);
    return globalThis.fetch(url, mergedOptions);
}

export function setupProxySupport(): void {
    handler.updateProxies().catch(error => {
        console.error(`[${new Date().toISOString()}] Failed to initialize proxy support:`, error);
    });
}