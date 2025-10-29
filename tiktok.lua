-- ServerScriptService/ExternalRedeem.lua
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- expects RedeemKeyEvent RemoteEvent created in ReplicatedStorage by KeyManager (or create here)
local redeemEvent = ReplicatedStorage:FindFirstChild("RedeemKeyEvent")
if not redeemEvent then
    redeemEvent = Instance.new("RemoteEvent")
    redeemEvent.Name = "RedeemKeyEvent"
    redeemEvent.Parent = ReplicatedStorage
end

local API_URL = "https://your-domain.com" -- replace with your server URL
local API_SECRET = "YOUR_SERVER_SECRET" -- put this value in your Roblox server script (not in LocalScript!)

local function callClaimAPI(keyString, userId)
    local payload = {
        key = tostring(keyString),
        userId = userId
    }
    local body = HttpService:JSONEncode(payload)

    local headers = {
        ["Content-Type"] = "application/json",
        ["x-server-secret"] = API_SECRET
    }

    local ok, resp = pcall(function()
        return HttpService:RequestAsync({
            Url = API_URL .. "/claim",
            Method = "POST",
            Headers = headers,
            Body = body,
        })
    end)

    if not ok then
        return false, "http_failed"
    end

    if resp.StatusCode ~= 200 and resp.StatusCode ~= 201 then
        -- Try decoding body if possible
        local success, data = pcall(function() return HttpService:JSONDecode(resp.Body) end)
        if success and data and data.err then
            return false, data.err
        end
        return false, "server_error_" .. tostring(resp.StatusCode)
    end

    local success, data = pcall(function() return HttpService:JSONDecode(resp.Body) end)
    if not success then
        return false, "invalid_response"
    end

    if not data.ok then
        return false, data.err or "claim_failed"
    end

    return true, data.reward
end

-- Listen for client requests to redeem (client sends key string)
redeemEvent.OnServerEvent:Connect(function(player, keyString)
    if type(keyString) ~= "string" then
        redeemEvent:FireClient(player, { ok = false, err = "invalid_key" })
        return
    end

    local ok, result = callClaimAPI(keyString, player.UserId)
    if not ok then
        redeemEvent:FireClient(player, { ok = false, err = result })
        return
    end

    -- result is reward object from server (e.g. {coins = 100})
    -- Grant reward server-side
    if result and result.coins then
        local stats = player:FindFirstChild("leaderstats")
        if stats then
            local coins = stats:FindFirstChild("Coins")
            if coins then
                coins.Value = coins.Value + tonumber(result.coins)
            end
        end
    end

    redeemEvent:FireClient(player, { ok = true, reward = result })
end)
