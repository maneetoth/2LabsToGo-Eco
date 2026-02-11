import os
import urllib.error
import urllib.parse
import urllib.request

from django.http import HttpResponse


_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def proxy_to_nextjs(request, path=""):
    """Reverse-proxy /next/* from Django to the Next.js container.

    This enables accessing Next.js via the Django port (8000) without relying on nginx.
    """

    upstream_base = os.environ.get("NEXTJS_UPSTREAM", "http://nextjs:3000").rstrip("/")

    # Preserve the /next prefix, because the nginx setup proxies /next/* as-is.
    downstream_path = request.path
    if request.META.get("QUERY_STRING"):
        downstream_path = f"{downstream_path}?{request.META['QUERY_STRING']}"

    upstream_url = urllib.parse.urljoin(upstream_base + "/", downstream_path.lstrip("/"))

    body = request.body if request.method not in {"GET", "HEAD"} else None

    # Forward request headers (minus hop-by-hop headers) so Next can serve correct content.
    upstream_headers = {}
    for key, value in request.headers.items():
        lk = key.lower()
        if lk in _HOP_BY_HOP_HEADERS:
            continue
        # Host should be the upstream host.
        if lk == "host":
            continue
        upstream_headers[key] = value

    req = urllib.request.Request(
        upstream_url,
        data=body,
        headers=upstream_headers,
        method=request.method,
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as upstream_resp:
            content = upstream_resp.read()
            status = upstream_resp.getcode() or 200
            resp = HttpResponse(content, status=status)

            for header_key, header_val in upstream_resp.headers.items():
                lk = header_key.lower()
                if lk in _HOP_BY_HOP_HEADERS:
                    continue
                # Django will set Content-Length based on body.
                if lk == "content-length":
                    continue

                if lk == "location":
                    # Rewrite absolute redirects back to this server.
                    # If Next.js returns relative redirects, keep them as-is.
                    try:
                        parsed = urllib.parse.urlparse(header_val)
                        if parsed.scheme and parsed.netloc:
                            current = f"{request.scheme}://{request.get_host()}"
                            upstream_origin = urllib.parse.urlparse(upstream_base)
                            if parsed.netloc == upstream_origin.netloc:
                                header_val = urllib.parse.urljoin(current + "/", parsed.path.lstrip("/"))
                                if parsed.query:
                                    header_val += "?" + parsed.query
                    except Exception:
                        pass

                resp[header_key] = header_val

            return resp

    except urllib.error.HTTPError as e:
        # Upstream returned a non-2xx response; forward it.
        content = e.read() if hasattr(e, "read") else (str(e).encode("utf-8"))
        resp = HttpResponse(content, status=e.code)
        if e.headers:
            for header_key, header_val in e.headers.items():
                lk = header_key.lower()
                if lk in _HOP_BY_HOP_HEADERS or lk == "content-length":
                    continue
                resp[header_key] = header_val
        return resp
    except Exception as e:
        return HttpResponse(f"Next.js upstream unreachable: {e}", status=502, content_type="text/plain")
